import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import { outbox } from '../schema/index.js';

import { createTransactionPort } from '../transaction.js';

import { listPendingOutbox } from './runtime.js';

import type { JobEnvelope } from '@antica/contracts';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated PostgreSQL database',
  );
}

const startedAt = '2026-10-13T00:00:00.000Z';
const updatedAt = '2026-10-13T00:00:01.000Z';

describe('fn:createJobRepository', () => {
  it('should keep command receipts, jobs, and outbox delivery scoped to their owner', async () => {
    const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
    const transaction = createTransactionPort(database.db);
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();
    const job: JobEnvelope = {
      id: randomUUID(),
      kind: 'analysis',
      resourceId: randomUUID(),
      state: { kind: 'queued' },
      createdAt: startedAt,
      updatedAt: startedAt,
      result: null,
    };
    const requestKey = randomUUID();
    const receipt = {
      ownerId,
      operation: 'analysis.request',
      requestKey,
      fingerprint: 'frozen-request',
      status: 202,
      result: { runId: job.resourceId },
    };
    const message = {
      id: randomUUID(),
      name: 'antica.analysis.requested',
      event: {
        eventId: randomUUID(),
        schemaVersion: '1',
        jobId: job.id,
        resourceId: job.resourceId,
        ownerId,
        idempotencyKey: requestKey,
      },
      createdAt: startedAt,
      sentAt: null,
    };

    try {
      await transaction.run(ownerId, async (unit) => {
        await unit.jobs.create(job);
        await unit.commands.insert(receipt);
        await unit.outbox.enqueue(message);

        return { success: true as const, data: undefined };
      });
      await database.db
        .update(outbox)
        .set({ availableAt: startedAt })
        .where(eq(outbox.eventId, message.id));
      const saved = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          job: await unit.jobs.getByResource('analysis', job.resourceId),
          receipt: await unit.commands.get(
            ownerId,
            receipt.operation,
            requestKey,
          ),
          missingReceipt: await unit.commands.get(
            ownerId,
            receipt.operation,
            randomUUID(),
          ),
          pending: await unit.outbox.pending(1),
        },
      }));
      expect({
        ...saved.data,
        pending: saved.data.pending.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt).toISOString(),
        })),
      }).toEqual({ job, receipt, missingReceipt: null, pending: [message] });
      await expect(
        transaction.run(otherOwnerId, async (unit) => {
          await unit.commands.insert(receipt);

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Command owner mismatch');
      await expect(
        transaction.run(otherOwnerId, async (unit) => {
          await unit.outbox.enqueue(message);

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Outbox owner mismatch');
      const other = await transaction.run(otherOwnerId, async (unit) => ({
        success: true as const,
        data: {
          job: await unit.jobs.get(job.id),
          byResource: await unit.jobs.getByResource('analysis', job.resourceId),
          receipt: await unit.commands.get(
            ownerId,
            receipt.operation,
            requestKey,
          ),
          pending: await unit.outbox.pending(1),
          update: await unit.jobs.update(
            { ...job, state: { kind: 'running', stage: 'analyze' } },
            startedAt,
          ),
        },
      }));
      expect(other.data).toEqual({
        job: null,
        byResource: null,
        receipt: null,
        pending: [],
        update: false,
      });
      expect(
        (await listPendingOutbox(database.db, 100)).some(
          ({ id, ownerId: foundOwner }) =>
            id === message.id && foundOwner === ownerId,
        ),
      ).toBe(true);

      await transaction.run(otherOwnerId, async (unit) => {
        await unit.outbox.markSent(message.id, updatedAt);

        return { success: true as const, data: undefined };
      });
      const stillPending = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.outbox.pending(1),
      }));
      expect(
        stillPending.data.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt).toISOString(),
        })),
      ).toEqual([message]);
      await transaction.run(ownerId, async (unit) => {
        await unit.outbox.markSent(message.id, updatedAt);

        return { success: true as const, data: undefined };
      });
      const delivered = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: await unit.outbox.pending(1),
      }));
      expect(delivered.data).toEqual([]);
      expect(
        (await listPendingOutbox(database.db, 100)).some(
          ({ id }) => id === message.id,
        ),
      ).toBe(false);
    } finally {
      await database.close();
    }
  });

  it('should reject stale job and step revisions while deduplicating provider callbacks', async () => {
    const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
    const transaction = createTransactionPort(database.db);
    const ownerId = randomUUID();
    const job: JobEnvelope = {
      id: randomUUID(),
      kind: 'research',
      resourceId: randomUUID(),
      state: { kind: 'queued' },
      createdAt: startedAt,
      updatedAt: startedAt,
      result: null,
    };
    const providerJobId = randomUUID();
    const eventId = randomUUID();

    try {
      const initial = await transaction.run(ownerId, async (unit) => {
        await unit.jobs.create(job);
        await unit.jobs.mapProviderJob(
          'development',
          providerJobId,
          job.id,
          'parse',
        );

        return {
          success: true as const,
          data: {
            mapping: await unit.jobs.getProviderJob(
              'development',
              providerJobId,
            ),
            absentStep: await unit.jobs.getStep(job.id, 'parse'),
            absentEvent: await unit.jobs.hasProviderEvent(
              'development',
              eventId,
            ),
          },
        };
      });
      expect(initial.data).toEqual({
        mapping: { jobId: job.id, step: 'parse' },
        absentStep: null,
        absentEvent: false,
      });
      const step = {
        jobId: job.id,
        step: 'parse',
        revision: 1,
        state: 'waiting' as const,
        leaseUntil: null,
        checkpoint: { providerJobId },
        result: null,
      };
      const transition = await transaction.run(ownerId, async (unit) => {
        const created = await unit.jobs.updateStep(step, 0);
        const duplicate = await unit.jobs.updateStep(step, 0);
        const changed = await unit.jobs.updateStep(
          { ...step, revision: 2, state: 'completed', result: { pages: 2 } },
          1,
        );
        const stale = await unit.jobs.updateStep(step, 1);
        await unit.jobs.recordProviderEvent('development', eventId, job.id);
        await unit.jobs.recordProviderEvent('development', eventId, job.id);

        return {
          success: true as const,
          data: {
            created,
            duplicate,
            changed,
            stale,
            step: await unit.jobs.getStep(job.id, 'parse'),
            recorded: await unit.jobs.hasProviderEvent('development', eventId),
          },
        };
      });
      expect(transition.data).toEqual({
        created: true,
        duplicate: false,
        changed: true,
        stale: false,
        step: {
          ...step,
          revision: 2,
          state: 'completed',
          result: { pages: 2 },
        },
        recorded: true,
      });
      const leased = await transaction.run(ownerId, async (unit) => {
        const updated = await unit.jobs.updateStep(
          {
            ...step,
            revision: 3,
            state: 'leased',
            leaseUntil: updatedAt,
            result: null,
          },
          2,
        );

        return {
          success: true as const,
          data: {
            updated,
            step: await unit.jobs.getStep(job.id, 'parse'),
          },
        };
      });
      expect(leased.data).toEqual({
        updated: true,
        step: { ...step, revision: 3, state: 'leased', leaseUntil: updatedAt },
      });
      const failed: JobEnvelope = {
        ...job,
        state: {
          kind: 'failed',
          error: {
            code: 'JOB_FAILED',
            message: 'Provider failed',
            retryable: true,
            requestId: randomUUID(),
          },
        },
        updatedAt,
      };
      const completion = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          stale: await unit.jobs.update(failed, '2026-10-12T00:00:00.000Z'),
          failed: await unit.jobs.update(failed, startedAt),
          terminal: await unit.jobs.update(
            { ...failed, state: { kind: 'succeeded', completedAt: updatedAt } },
            updatedAt,
          ),
          restart: await unit.jobs.restartFailed(
            job.id,
            updatedAt,
            '2026-10-13T00:00:02.000Z',
          ),
          job: await unit.jobs.get(job.id),
        },
      }));
      expect(completion.data).toMatchObject({
        stale: false,
        failed: true,
        terminal: false,
        restart: true,
        job: { state: { kind: 'running', stage: 'retry' } },
      });
      const otherOwnerId = randomUUID();
      const inaccessible = await transaction.run(
        otherOwnerId,
        async (unit) => ({
          success: true as const,
          data: {
            step: await unit.jobs.getStep(job.id, 'parse'),
            mapping: await unit.jobs.getProviderJob(
              'development',
              providerJobId,
            ),
            event: await unit.jobs.hasProviderEvent('development', eventId),
            createStep: await unit.jobs.updateStep(
              {
                jobId: job.id,
                step: 'other',
                revision: 1,
                state: 'ready',
                leaseUntil: null,
                checkpoint: null,
                result: null,
              },
              0,
            ),
          },
        }),
      );
      expect(inaccessible.data).toEqual({
        step: null,
        mapping: null,
        event: false,
        createStep: false,
      });
      await expect(
        transaction.run(otherOwnerId, async (unit) => {
          await unit.jobs.mapProviderJob(
            'development',
            randomUUID(),
            job.id,
            'parse',
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Job not found');
      await expect(
        transaction.run(ownerId, async (unit) => {
          await unit.jobs.recordProviderEvent(
            'development',
            randomUUID(),
            randomUUID(),
          );

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Provider job mapping missing');
    } finally {
      await database.close();
    }
  });

  it('should reopen durable waiting, partial, and succeeded job states with their results', async () => {
    const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
    const transaction = createTransactionPort(database.db);
    const ownerId = randomUUID();
    const cases: readonly JobEnvelope[] = [
      {
        id: randomUUID(),
        kind: 'media',
        resourceId: randomUUID(),
        state: { kind: 'waiting', stage: 'provider' },
        createdAt: startedAt,
        updatedAt: startedAt,
        result: null,
      },
      {
        id: randomUUID(),
        kind: 'sourceIngestion',
        resourceId: randomUUID(),
        state: {
          kind: 'partial',
          completedAt: updatedAt,
          incompleteStages: ['index'],
        },
        createdAt: startedAt,
        updatedAt,
        result: { incompleteStages: ['index'] },
      },
      {
        id: randomUUID(),
        kind: 'transcription',
        resourceId: randomUUID(),
        state: { kind: 'succeeded', completedAt: updatedAt },
        createdAt: startedAt,
        updatedAt,
        result: { text: 'Saved' },
      },
      {
        id: randomUUID(),
        kind: 'sourceIngestion',
        resourceId: randomUUID(),
        state: {
          kind: 'partial',
          completedAt: updatedAt,
          incompleteStages: [],
        },
        createdAt: startedAt,
        updatedAt,
        result: null,
      },
      {
        id: randomUUID(),
        kind: 'research',
        resourceId: randomUUID(),
        state: {
          kind: 'failed',
          error: {
            code: 'JOB_FAILED',
            message: 'Provider unavailable',
            retryable: true,
            requestId: randomUUID(),
          },
        },
        createdAt: startedAt,
        updatedAt,
        result: null,
      },
    ];
    try {
      const result = await transaction.run(ownerId, async (unit) => {
        for (const job of cases) {
          await unit.jobs.create(job);
        }

        return {
          success: true as const,
          data: await Promise.all(
            cases.map(async ({ id }) => unit.jobs.get(id)),
          ),
        };
      });
      expect(result.data).toEqual(cases);
    } finally {
      await database.close();
    }
  });
});
