import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import { createOutboxDrain } from '@antica/application/server';
import { jobKindSchema } from '@antica/contracts';

import {
  createTransactionPort,
  listPendingOutbox,
} from '@antica/platform/database';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import {
  createProviderFixture,
  createSnapshot,
  instant,
} from './fixtures/provider.js';

import type { JobHandler } from '@antica/application/server';
import type { JobEnvelope, JobKind } from '@antica/contracts';

import type { Database } from '@antica/platform/database';

describe(
  'fn:createOutboxDrain:seven persisted job kinds',
  { timeout: 60_000 },
  () => {
    it.for(jobKindSchema.options)(
      'should dispatch and settle the persisted %s job through its own handler',
      async (kind, { database: { db } }) => {
        if (kind === 'knowledgeImport') {
          const fixture = createImportFixture(
            db,
            createProviderFixture({ snapshots: [createSnapshot()] }),
          );
          const run = await requestRun(fixture);
          const drain = createOutboxDrain({
            transaction: createTransactionPort(db),
            handlers: {
              knowledgeImport: async (_ownerId, jobId) => fixture.handle(jobId),
            },
            clock: { now: () => fixture.clock.value },
            listPending: async (limit) => listPendingOutbox(db, limit),
          });
          expect(await listPendingOutbox(db, 10)).toMatchObject([
            { name: 'antica/knowledgeImport.requested' },
          ]);
          expect(await drain()).toEqual({
            inspected: 1,
            settled: 1,
            deferred: 0,
            failures: [],
          });
          expect(
            await fixture.store.get(fixture.ownerId, run.id),
          ).toMatchObject({ status: 'completed', counts: { imported: 1 } });
          expect(await listPendingOutbox(db, 10)).toEqual([]);
          expect(await drain()).toEqual({
            inspected: 0,
            settled: 0,
            deferred: 0,
            failures: [],
          });

          return;
        }
        const ownerId = randomUUID();
        const job: JobEnvelope = {
          id: randomUUID(),
          kind,
          resourceId: randomUUID(),
          state: { kind: 'queued' },
          createdAt: instant,
          updatedAt: instant,
          result: null,
        };
        const transaction = createTransactionPort(db);
        await transaction.run(ownerId, async (unit) => {
          await unit.jobs.create(job);
          await unit.outbox.enqueue({
            id: randomUUID(),
            name: `antica.${kind}.requested`,
            createdAt: instant,
            sentAt: null,
            event: {
              eventId: randomUUID(),
              schemaVersion: '1',
              jobId: job.id,
              resourceId: job.resourceId,
              ownerId,
              idempotencyKey: randomUUID(),
            },
          });

          return { success: true, data: undefined };
        });
        await db.outbox.updateMany({
          where: { ownerId },
          data: { availableAt: instant },
        });
        const handlers = {
          analysis: completingHandler(db, 'analysis'),
          media: completingHandler(db, 'media'),
          sourceIngestion: completingHandler(db, 'sourceIngestion'),
          research: completingHandler(db, 'research'),
          transcription: completingHandler(db, 'transcription'),
          recordEditing: completingHandler(db, 'recordEditing'),
          knowledgeImport: completingHandler(db, 'knowledgeImport'),
        } satisfies Record<JobKind, JobHandler>;
        const drain = createOutboxDrain({
          transaction,
          handlers,
          clock: { now: () => instant },
          listPending: async (limit) => listPendingOutbox(db, limit),
        });

        expect(await drain()).toEqual({
          inspected: 1,
          settled: 1,
          deferred: 0,
          failures: [],
        });
        expect(
          await db.jobs.findUnique({ where: { id: job.id } }),
        ).toMatchObject({ kind, state: 'succeeded' });
        expect(await listPendingOutbox(db, 10)).toEqual([]);
        expect(await drain()).toEqual({
          inspected: 0,
          settled: 0,
          deferred: 0,
          failures: [],
        });
      },
    );
  },
);

/**
 * completes only the job belonging to this dispatch branch
 * @param db real repository database
 * @param kind handler-specific accepted job kind
 * @returns bounded test workload with a durable completion effect
 */
function completingHandler(db: Database, kind: JobKind): JobHandler {
  return async (ownerId, jobId) => {
    const result = await db.jobs.updateMany({
      where: { id: jobId, ownerId, kind },
      data: { state: 'succeeded', completedAt: instant },
    });

    return result.count === 1
      ? { success: true, data: undefined }
      : {
          success: false,
          error: {
            code: 'JOB_FAILED',
            message: 'Wrong dispatch branch',
            retryable: false,
          },
        };
  };
}

describe(
  'fn:createOutboxDrain:knowledge import deferral',
  { timeout: 60_000 },
  () => {
    it('should report a live duplicate lease as deferred and settle only after the next worker completes', async ({
      database: { db },
    }) => {
      const adapter = createProviderFixture({ snapshots: [createSnapshot()] });
      const fixture = createImportFixture(db, adapter);
      const run = await requestRun(fixture);
      expect(await fixture.store.claim(run.jobId)).not.toBeNull();
      const drain = createOutboxDrain({
        transaction: createTransactionPort(db),
        handlers: {
          knowledgeImport: async (_ownerId, jobId) => fixture.handle(jobId),
        },
        clock: { now: () => fixture.clock.value },
        listPending: async (limit) => listPendingOutbox(db, limit),
      });
      expect(await fixture.handle(run.jobId)).toEqual({
        success: true,
        data: { settled: false },
      });
      expect(await drain()).toEqual({
        inspected: 1,
        settled: 0,
        deferred: 1,
        failures: [],
      });
      expect(adapter.fetched).toEqual([]);
      expect(await listPendingOutbox(db, 10)).toHaveLength(1);
      fixture.clock.value = '2026-10-19T00:00:02.000Z';
      expect(await drain()).toEqual({
        inspected: 1,
        settled: 1,
        deferred: 0,
        failures: [],
      });
      expect(adapter.fetched).toEqual(['object-1']);
      expect(await listPendingOutbox(db, 10)).toEqual([]);
    });

    it('should report a committed nonterminal batch as deferred until every selected object finishes', async ({
      database: { db },
    }) => {
      const snapshots = Array.from({ length: 51 }, (_, index) =>
        createSnapshot(`object-${index}`),
      );
      const fixture = createImportFixture(
        db,
        createProviderFixture({ snapshots }),
      );
      await requestRun(
        fixture,
        createRequest(snapshots.map(({ objectId }) => objectId)),
      );
      const drain = createOutboxDrain({
        transaction: createTransactionPort(db),
        handlers: {
          knowledgeImport: async (_ownerId, jobId) => fixture.handle(jobId),
        },
        clock: { now: () => fixture.clock.value },
        listPending: async (limit) => listPendingOutbox(db, limit),
      });
      expect(await drain()).toEqual({
        inspected: 1,
        settled: 0,
        deferred: 1,
        failures: [],
      });
      expect(await listPendingOutbox(db, 10)).toHaveLength(1);
      expect(await drain()).toEqual({
        inspected: 1,
        settled: 1,
        deferred: 0,
        failures: [],
      });
      expect(await listPendingOutbox(db, 10)).toEqual([]);
    });
  },
);

describe(
  'fn:createOutboxDrain:import error isolation',
  { timeout: 60_000 },
  () => {
    it('should defer a thrown slash-event handler and continue to complete the next real import', async ({
      database: { db },
    }) => {
      const fixture = createImportFixture(
        db,
        createProviderFixture({ snapshots: [createSnapshot()] }),
      );
      const first = await requestRun(fixture);
      const second = await requestRun(fixture);
      const drain = createOutboxDrain({
        transaction: createTransactionPort(db),
        handlers: {
          knowledgeImport: async (_ownerId, jobId) => {
            if (jobId === first.jobId) {
              throw new Error('Injected transient connection failure');
            }

            return fixture.handle(jobId);
          },
        },
        clock: { now: () => fixture.clock.value },
        listPending: async (limit) => listPendingOutbox(db, limit),
      });
      expect(await drain()).toEqual({
        inspected: 2,
        settled: 1,
        deferred: 1,
        failures: [{ jobId: first.jobId, code: 'JOB_FAILED' }],
      });
      expect(await fixture.store.get(fixture.ownerId, first.id)).toMatchObject({
        status: 'queued',
        counts: { processed: 0 },
      });
      expect(await fixture.store.get(fixture.ownerId, second.id)).toMatchObject(
        { status: 'completed', counts: { imported: 1 } },
      );
      expect(await listPendingOutbox(db, 10)).toMatchObject([
        { event: { jobId: first.jobId } },
      ]);
    });
  },
);
