import { describe, expect } from 'vitest';

import { KnowledgeProviderError } from '@antica/contracts';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type {
  ImportBatch,
  ImportBatchLease,
  ProviderSnapshot,
} from '@antica/contracts';

describe('fn:createKnowledgeImportHandler', { timeout: 60_000 }, () => {
  it('should recover an uncommitted fetched batch and reject a stale out-of-order lease', async ({
    database: { db },
  }) => {
    const snapshot = createSnapshot();
    const adapter = createProviderFixture({ snapshots: [snapshot] });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture);
    const abandoned = await fixture.store.claim(run.jobId);
    expect(abandoned).not.toBeNull();
    if (!abandoned) {
      throw new Error('Expected batch lease');
    }
    const batch = capturedBatch(abandoned, snapshot);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(0);
    fixture.clock.value = '2026-10-19T00:00:02.000Z';

    await fixture.handle(run.jobId);
    await fixture.store.commit(abandoned, batch).catch(() => undefined);

    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(
      await db.importItem.findMany({ where: { runId: run.id } }),
    ).toMatchObject([{ providerObjectId: snapshot.objectId, attemptCount: 1 }]);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      counts: { processed: 1 },
    });
  });

  it('should survive a lost commit acknowledgement and duplicate delivery without duplicate writes', async ({
    database: { db },
  }) => {
    const snapshot = createSnapshot();
    const fixture = createImportFixture(
      db,
      createProviderFixture({ snapshots: [snapshot] }),
    );
    const run = await requestRun(fixture);
    const lease = await fixture.store.claim(run.jobId);
    if (!lease) {
      throw new Error('Expected batch lease');
    }
    const batch = capturedBatch(lease, snapshot);
    await fixture.store.commit(lease, batch);

    await expect(fixture.store.commit(lease, batch)).resolves.toBe(false);
    await fixture.handle(run.jobId);

    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(
      await db.knowledgeRevisions.count({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      }),
    ).toBe(1);
    expect(await db.importItem.count({ where: { runId: run.id } })).toBe(1);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      counts: { processed: 1 },
    });
  });

  it('should honor Retry-After without fetching again before the deferred instant', async ({
    database: { db },
  }) => {
    const snapshot = createSnapshot();
    const adapter = createProviderFixture({
      snapshots: [snapshot],
      outcomes: {
        'object-1': [
          new KnowledgeProviderError({
            code: 'RATE_LIMITED',
            retryable: true,
            retryAfter: '120',
          }),
          { kind: 'snapshot', value: snapshot },
        ],
      },
    });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture);
    await fixture.handle(run.jobId);

    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      retryAfter: '2026-10-19T00:02:00.000Z',
    });
    await fixture.handle(run.jobId);
    expect(adapter.fetched).toEqual(['object-1']);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(0);
    fixture.clock.value = '2026-10-19T00:02:01.000Z';
    await fixture.handle(run.jobId);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      counts: { imported: 1 },
    });
  });

  it('should retain failed receipts and stop retrying at the bounded attempt limit', async ({
    database: { db },
  }) => {
    const adapter = createProviderFixture({
      snapshots: [createSnapshot()],
      outcomes: {
        'object-1': [
          new KnowledgeProviderError({
            code: 'UPSTREAM_FAILED',
            retryable: true,
          }),
        ],
      },
    });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      fixture.clock.value = `2026-10-19T00:0${attempt}:00.000Z`;
      await fixture.handle(run.jobId);
    }

    expect(adapter.fetched).toEqual(['object-1', 'object-1', 'object-1']);
    expect(
      await db.importItem.findMany({ where: { runId: run.id } }),
    ).toMatchObject([
      { status: 'failed', attemptCount: 3, errorCode: 'UPSTREAM_FAILED' },
    ]);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'partial',
      retryList: [
        { objectId: 'object-1', attemptCount: 3, errorCode: 'UPSTREAM_FAILED' },
      ],
    });
  });

  it('should retry failed objects without repeating successfully imported objects', async ({
    database: { db },
  }) => {
    const first = createSnapshot();
    const second = createSnapshot('object-2');
    const adapter = createProviderFixture({
      snapshots: [first, second],
      outcomes: {
        'object-2': [
          new KnowledgeProviderError({
            code: 'UPSTREAM_FAILED',
            retryable: true,
          }),
          { kind: 'snapshot', value: second },
        ],
      },
    });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(
      fixture,
      createRequest(['object-1', 'object-2']),
    );
    await fixture.handle(run.jobId);
    fixture.clock.value = '2026-10-19T00:01:00.000Z';
    await fixture.handle(run.jobId);

    expect(adapter.fetched).toEqual(['object-1', 'object-2', 'object-2']);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      retryList: [],
      counts: { imported: 2, failed: 0 },
    });
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(2);
  });

  it('should finish the current batch on cancellation and resume the same run from its checkpoint', async ({
    database: { db },
  }) => {
    const snapshots = Array.from({ length: 51 }, (_, index) =>
      createSnapshot(`object-${index}`),
    );
    const adapter = createProviderFixture({
      snapshots,
      onFetch: async () => {
        await fixture.service.cancel(fixture.ownerId, run.id);
      },
    });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(
      fixture,
      createRequest(snapshots.map(({ objectId }) => objectId)),
    );
    await fixture.handle(run.jobId);

    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'cancelled',
      counts: { processed: 50 },
    });
    await fixture.handle(run.jobId);
    expect(adapter.fetched).toHaveLength(50);
    const resumed = await fixture.service.resume(fixture.ownerId, run.id);
    expect(resumed).toMatchObject({
      success: true,
      data: { id: run.id, jobId: run.jobId },
    });
    await fixture.handle(run.jobId);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(51);
    expect(new Set(adapter.fetched).size).toBe(51);
  });

  it('should pause before exhausting SQL headroom and expose the reason without importing objects', async ({
    database: { db },
  }) => {
    const adapter = createProviderFixture({ snapshots: [createSnapshot()] });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture, createRequest(['object-1'], 16));
    await fixture.handle(run.jobId);
    const status = await fixture.store.get(fixture.ownerId, run.id);

    expect(status).toMatchObject({
      status: 'partial',
      counts: { imported: 0 },
    });
    expect(status?.reason).toMatch(/budget/i);
    expect(
      status!.counts.sqlOperations + status!.counts.reservedOperations,
    ).toBeLessThanOrEqual(16);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(0);
  });

  it('should freeze deterministic query pages and import every selected object once', async ({
    database: { db },
  }) => {
    const snapshots = [
      createSnapshot('one'),
      createSnapshot('two'),
      createSnapshot('three'),
    ];
    const adapter = createProviderFixture({ snapshots, pageSize: 1 });
    const fixture = createImportFixture(db, adapter);
    const input = createRequest();
    const run = await requestRun(fixture, {
      ...input,
      selection: {
        kind: 'query',
        provider: 'fixture',
        query: { category: 'ceramics' },
        maxObjects: 3,
        maxBytes: 2_097_152,
        deadline: '2026-10-20T00:00:00.000Z',
      },
    });
    for (let page = 0; page < 3; page += 1) {
      await fixture.handle(run.jobId);
    }

    expect(adapter.fetched).toEqual(['one', 'two', 'three']);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      counts: { processed: 3, imported: 3 },
    });
    expect(
      await db.externalObject.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(3);
  });

  it('should require an explicit restart when the adapter version changes', async ({
    database: { db },
  }) => {
    const adapter = createProviderFixture({ snapshots: [createSnapshot()] });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture);
    await db.importRun.update({
      where: { id: run.id },
      data: { adapterVersion: 'obsolete-v0' },
    });

    expect(await fixture.service.resume(fixture.ownerId, run.id)).toMatchObject(
      { success: false, error: { code: 'REVISION_CONFLICT' } },
    );
    await fixture.handle(run.jobId);
    expect(adapter.fetched).toEqual([]);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(0);
  });
});

/**
 * represents the work already fetched when a worker loses its connection
 * @param lease persisted checkpoint and fencing token
 * @param snapshot fully captured object
 * @returns deterministic batch ready for an atomic commit
 */
function capturedBatch(
  lease: ImportBatchLease,
  snapshot: ProviderSnapshot,
): ImportBatch {
  return {
    checkpoint: {
      ...lease.checkpoint,
      sequence: lease.checkpoint.sequence,
      manifest: [snapshot.objectId],
      offset: 1,
      listed: true,
    },
    objects: [
      {
        kind: 'snapshot',
        objectId: snapshot.objectId,
        snapshot,
        mapped: createProviderFixture({ snapshots: [snapshot] }).map(snapshot),
        bytes: new TextEncoder().encode(JSON.stringify(snapshot.payload))
          .length,
      },
    ],
    reason: null,
    retryAfter: null,
    stop: false,
  };
}
