import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createMediaJobHandler,
  createMediaService,
  createOutboxDrain,
  createRecordService,
} from '@antica/application/server';

import {
  processImage,
  createLocalMediaStore,
  createDatabase,
  createTransactionPort,
} from '@antica/platform';

import type { OutboxMessage } from '@antica/application/ports';
import type { JobHandler } from '@antica/application/server';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Persistent media completion', () => {
  it.each(['object', 'receipt'] as const)(
    'should finish %s media exactly once with the appropriate analysis version effect',
    async (purpose) => {
      const database = createDatabase({ url: databaseUrl });
      const root = await mkdtemp(join(tmpdir(), 'antica-media-job-'));
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      const records = createRecordService(transaction, clock, ids);
      const store = createLocalMediaStore({
        root,
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'acceptance-job-secret-at-least-32-characters',
      });
      const media = createMediaService(transaction, store, clock, ids);
      const process = vi.fn(async (input: Parameters<typeof processImage>[0]) =>
        processImage(input),
      );
      const handler = createMediaJobHandler(
        transaction,
        { processImage: async (input) => process({ ...input, store }) },
        clock,
        ids,
      );
      try {
        const created = await records.create(ownerId, randomUUID(), {
          unitKind: 'single',
        });
        if (!created.success) {
          throw new Error('Record fixture failed');
        }
        const bytes = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
          'base64',
        );
        const started = await media.start(ownerId, {
          requestKey: randomUUID(),
          target: { kind: 'record', recordId: created.data.id },
          kind: 'photo',
          purpose,
          componentIds: [],
          fileName: 'capture.png',
          mimeType: 'image/png',
          byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
        if (!started.success || started.data.mode !== 'single') {
          throw new Error('Upload fixture failed');
        }
        await store.acceptUploadToken(
          new URL(started.data.putUrl).pathname.split('/').at(-1)!,
          bytes,
          'image/png',
        );
        expect(
          await media.complete(ownerId, started.data.assetId, randomUUID()),
        ).toMatchObject({ success: true });
        const pending = await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.outbox.pending(100),
        }));
        if (!pending.data[0]) {
          throw new Error('Media job was not enqueued');
        }
        expect(await handler(ownerId, pending.data[0].event.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        expect(await handler(ownerId, pending.data[0].event.jobId)).toEqual({
          success: true,
          data: undefined,
        });
        expect(process).toHaveBeenCalledTimes(1);
        const ready = await media.get(ownerId, started.data.assetId);
        expect(ready).toMatchObject({
          success: true,
          data: {
            asset: {
              state: 'ready',
              views: [
                expect.objectContaining({
                  originalAssetId: started.data.assetId,
                }),
              ],
            },
          },
        });
        const version = purpose === 'object' ? 2 : 1;
        expect(await records.get(ownerId, created.data.id)).toMatchObject({
          success: true,
          data: {
            analysisInputVersion: version,
            evidenceVersion: version,
            latestRunId: null,
          },
        });
        expect(
          (await store.read(`originals/${started.data.assetId}`)).bytes,
        ).toEqual(bytes);
      } finally {
        await database.close();
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});

describe('fn:createOutboxDrain', () => {
  it.each(['retry', 'lease'] as const)(
    'should preserve a deferred %s job and settle its replay only once',
    async (scenario) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const jobId = randomUUID();
      const transaction = createTransactionPort(database.db);
      let now = clock.now();
      const workerClock = { now: (): string => now };
      const message: OutboxMessage = {
        id: randomUUID(),
        name: 'antica.analysis.requested',
        event: {
          eventId: randomUUID(),
          schemaVersion: '1',
          jobId,
          resourceId: randomUUID(),
          ownerId,
          idempotencyKey: randomUUID(),
        },
        createdAt: now,
        sentAt: null,
      };
      const handler = vi.fn<JobHandler>(async () =>
        transaction.run(ownerId, async (unit) => {
          const job = await unit.jobs.get(jobId);
          if (!job) {
            throw new Error('Persisted job missing');
          }
          await unit.jobs.update(
            {
              ...job,
              state: { kind: 'succeeded', completedAt: now },
              updatedAt: now,
              result: null,
            },
            job.updatedAt,
          );

          return { success: true, data: undefined };
        }),
      );
      try {
        await transaction.run(ownerId, async (unit) => {
          await unit.jobs.create({
            id: jobId,
            kind: 'analysis',
            resourceId: message.event.resourceId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.outbox.enqueue(message);
          if (scenario === 'lease') {
            await unit.jobs.updateStep(
              {
                jobId,
                step: 'dispatch',
                revision: 1,
                state: 'leased',
                leaseUntil: '2026-10-13T01:00:00.000Z',
                checkpoint: message.id,
                result: null,
              },
              0,
            );
          }

          return { success: true, data: undefined };
        });
        const drain = createOutboxDrain({
          transaction,
          clock: workerClock,
          handlers: { analysis: handler },
          listPending: async (limit) => {
            const result = await transaction.run(ownerId, async (unit) => ({
              success: true,
              data: await unit.outbox.pending(limit),
            }));

            return result.data;
          },
        });
        if (scenario === 'retry') {
          handler.mockResolvedValueOnce({
            success: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'Transient outage',
              retryable: true,
            },
          });
        }
        expect(await drain()).toMatchObject({
          inspected: 1,
          settled: 0,
          deferred: 1,
        });
        expect(handler).toHaveBeenCalledTimes(scenario === 'retry' ? 1 : 0);
        now = '2026-10-13T02:00:00.000Z';
        expect(await drain()).toEqual({
          inspected: 1,
          settled: 1,
          deferred: 0,
          failures: [],
        });
        expect(await drain()).toEqual({
          inspected: 0,
          settled: 0,
          deferred: 0,
          failures: [],
        });
        expect(handler).toHaveBeenCalledTimes(scenario === 'retry' ? 2 : 1);
      } finally {
        await database.close();
      }
    },
  );
});
