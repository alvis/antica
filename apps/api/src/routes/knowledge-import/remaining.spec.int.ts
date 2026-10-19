import { createHash } from 'node:crypto';

import { describe, expect } from 'vitest';

import { createKnowledgeImportHandler } from '@antica/application/server';
import { KnowledgeProviderError } from '@antica/contracts';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type { ProviderSnapshot } from '@antica/contracts';

describe(
  'fn:createKnowledgeImportHandler:remaining runtime boundaries',
  { timeout: 60_000 },
  () => {
    it('should apply bounded default random jitter when the caller omits a random source', async ({
      database: { db },
    }) => {
      const adapter = createProviderFixture({
        snapshots: [createSnapshot()],
        outcomes: {
          'object-1': [
            new KnowledgeProviderError({
              code: 'UNAVAILABLE',
              retryable: true,
            }),
          ],
        },
      });
      const fixture = createImportFixture(db, adapter);
      const run = await requestRun(fixture);
      const handler = createKnowledgeImportHandler({
        store: fixture.store,
        registry: new Map([[adapter.provider, adapter]]),
        now: () => fixture.clock.value,
      });
      expect(await handler(run.jobId)).toEqual({
        success: true,
        data: { settled: false },
      });
      const status = await fixture.store.get(fixture.ownerId, run.id);
      const delay =
        Date.parse(status!.retryAfter!) - Date.parse(fixture.clock.value);
      expect(delay).toBeGreaterThanOrEqual(1_000);
      expect(delay).toBeLessThanOrEqual(2_000);
      expect(status).toMatchObject({
        counts: { failed: 1 },
        retryList: [
          { objectId: 'object-1', errorCode: 'UNAVAILABLE', attemptCount: 1 },
        ],
      });
    });

    it('should reject invalid direct service input before creating any durable work', async ({
      database: { db },
    }) => {
      const fixture = createImportFixture(
        db,
        createProviderFixture({ snapshots: [] }),
      );
      expect(
        await fixture.service.request(fixture.ownerId, createRequest([])),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(
        await db.importRun.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
      expect(await db.jobs.count({ where: { ownerId: fixture.ownerId } })).toBe(
        0,
      );
      expect(
        await db.outbox.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(0);
    });

    it('should split valid objects at the 2MiB batch boundary and resume the first unfitted object', async ({
      database: { db },
    }) => {
      const snapshots = Array.from({ length: 5 }, (_, index) =>
        largeSnapshot(`large-${index}`),
      );
      const adapter = createProviderFixture({ snapshots });
      const fixture = createImportFixture(db, adapter);
      const input = createRequest(snapshots.map(({ objectId }) => objectId));
      const run = await requestRun(fixture, {
        ...input,
        selection: { ...input.selection, maxBytes: 20_000_000 },
      });
      expect(await fixture.handle(run.jobId)).toEqual({
        success: true,
        data: { settled: false },
      });
      const partial = await fixture.store.get(fixture.ownerId, run.id);
      expect(partial).toMatchObject({
        status: 'running',
        counts: { failed: 0 },
      });
      expect(partial!.counts.processed).toBeGreaterThan(0);
      expect(partial!.counts.processed).toBeLessThan(5);
      expect(partial!.counts.imported).toBe(partial!.counts.processed);
      expect(partial!.counts.bytes).toBeLessThanOrEqual(2_097_152);
      const firstUnfitted = snapshots[partial!.counts.processed]!.objectId;
      expect(adapter.fetched.at(-1)).toBe(firstUnfitted);
      expect(await fixture.handle(run.jobId)).toEqual({
        success: true,
        data: { settled: true },
      });
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 5, processed: 5, failed: 0 },
      });
      expect(adapter.fetched.filter((id) => id === firstUnfitted)).toHaveLength(
        2,
      );
      expect(
        await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
      ).toBe(5);
    });

    it('should avoid creating another disappearance candidate when an object is already missing', async ({
      database: { db },
    }) => {
      const snapshot = createSnapshot();
      const fixture = createImportFixture(
        db,
        createProviderFixture({
          snapshots: [snapshot],
          outcomes: {
            'object-1': [
              { kind: 'snapshot', value: snapshot },
              { kind: 'missing' },
            ],
          },
        }),
      );
      const first = await requestRun(fixture);
      await fixture.handle(first.jobId);
      const missing = await requestRun(fixture);
      await fixture.handle(missing.jobId);
      const repeated = await requestRun(fixture);
      await fixture.handle(repeated.jobId);
      expect(
        await db.reviewDiff.count({ where: { importRunId: missing.id } }),
      ).toBe(1);
      expect(
        await db.reviewDiff.count({ where: { importRunId: repeated.id } }),
      ).toBe(0);
      expect(
        await db.knowledgeRevisions.count({
          where: { knowledgeEntries: { ownerId: fixture.ownerId } },
        }),
      ).toBe(2);
      expect(
        await db.importItem.findMany({ where: { runId: repeated.id } }),
      ).toMatchObject([{ status: 'unchanged', errorCode: 'MISSING_UPSTREAM' }]);
    });
  },
);

/**
 * captures a canonical payload below the object cap but large enough to force batch splitting
 * @param objectId stable provider identifier
 * @returns captured JSON with bounded human-readable strings
 */
function largeSnapshot(objectId: string): ProviderSnapshot {
  const original = createSnapshot(objectId);
  const payload = {
    description: Array.from({ length: 10 }, () =>
      'Catalogue metadata description. '.repeat(500),
    ),
    images: [],
    title: '青花瓷瓶',
  };
  const payloadHash = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        objectId,
        payloadHash,
        provider: original.provider,
        schemaVersion: original.schemaVersion,
      }),
    )
    .digest('hex');

  return { ...original, payload, payloadHash, sourceHash };
}
