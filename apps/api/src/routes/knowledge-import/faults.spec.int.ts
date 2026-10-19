import { describe, expect } from 'vitest';

import { createImportFixture, it, requestRun } from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

describe(
  'fn:createKnowledgeImportHandler:transaction rollback guards',
  { timeout: 60_000 },
  () => {
    it('should roll back every batch write when the locked SQL reservation is insufficient', async ({
      database: { db },
    }) => {
      const snapshot = createSnapshot();
      const adapter = createProviderFixture({ snapshots: [snapshot] });
      const fixture = createImportFixture(db, adapter);
      const run = await requestRun(fixture);
      const lease = await fixture.store.claim(run.jobId);
      if (!lease) {
        throw new Error('Expected fixture lease');
      }
      await db.$executeRaw`update import_runs set counts = jsonb_set(counts, '{reservedOperations}', '1'::jsonb) where id = ${run.id}::uuid`;
      await expect(
        fixture.store.commit(lease, {
          checkpoint: { ...lease.checkpoint, offset: 1 },
          objects: [
            {
              kind: 'snapshot',
              objectId: snapshot.objectId,
              snapshot,
              mapped: adapter.map(snapshot),
              bytes: 1_000,
            },
          ],
          stop: false,
          reason: null,
          retryAfter: null,
        }),
      ).rejects.toThrow('Import SQL reservation was underestimated');
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
      expect(
        await db.knowledgeRevisions.count({
          where: { knowledgeEntries: { ownerId: fixture.ownerId } },
        }),
      ).toBe(0);
      expect(await db.importItem.count({ where: { runId: run.id } })).toBe(0);
      expect(
        await db.outbox.findMany({ where: { jobId: run.jobId } }),
      ).toMatchObject([{ deliveredAt: null }]);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'running',
        counts: { imported: 0, processed: 0 },
      });
    });

    it('should roll back a changed payload when PostgreSQL refuses the optimistic head update', async ({
      database: { db },
    }) => {
      const original = createSnapshot();
      const changed = createSnapshot('object-1', '青花瓷罐');
      const fixture = createImportFixture(
        db,
        createProviderFixture({
          snapshots: [original],
          outcomes: {
            'object-1': [
              { kind: 'snapshot', value: original },
              { kind: 'snapshot', value: changed },
            ],
          },
        }),
      );
      const first = await requestRun(fixture);
      await fixture.handle(first.jobId);
      const source = await db.sources.findFirstOrThrow({
        where: { ownerId: fixture.ownerId },
      });
      await db.$executeRaw`create function reject_import_head_update() returns trigger language plpgsql as $$ begin return null; end $$`;
      await db.$executeRaw`create trigger reject_import_head before update on knowledge_entries for each row execute function reject_import_head_update()`;
      const next = await requestRun(fixture);
      await expect(fixture.handle(next.jobId)).rejects.toThrow(
        'Import revision changed concurrently',
      );
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(1);
      expect(
        await db.sources.findFirst({ where: { ownerId: fixture.ownerId } }),
      ).toMatchObject({ currentVersionId: source.currentVersionId });
      expect(
        await db.knowledgeRevisions.findMany({
          where: { knowledgeEntries: { ownerId: fixture.ownerId } },
        }),
      ).toMatchObject([{ revision: 1 }]);
      expect(
        await db.knowledgeEntries.findMany({
          where: { ownerId: fixture.ownerId },
        }),
      ).toMatchObject([{ currentRevision: 1 }]);
      expect(await db.importItem.count({ where: { runId: next.id } })).toBe(0);
      expect(
        await db.reviewDiff.count({ where: { importRunId: next.id } }),
      ).toBe(0);
    });
  },
);
