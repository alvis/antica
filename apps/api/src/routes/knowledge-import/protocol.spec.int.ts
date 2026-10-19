import { randomUUID } from 'node:crypto';

import { describe, expect } from 'vitest';

import {
  createImportFixture,
  createRequest,
  it,
  requestRun,
} from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

describe('fn:createKnowledgeImportRepository', { timeout: 60_000 }, () => {
  it('should create one run, job and outbox atomically for duplicate request keys', async ({
    database: { db },
  }) => {
    const fixture = createImportFixture(
      db,
      createProviderFixture({ snapshots: [createSnapshot()] }),
    );
    const input = createRequest();
    const [first, duplicate] = await Promise.all([
      requestRun(fixture, input),
      requestRun(fixture, input),
    ]);

    expect(duplicate).toMatchObject({ id: first.id, jobId: first.jobId });
    expect(
      await db.importRun.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(
      await db.jobs.findMany({ where: { ownerId: fixture.ownerId } }),
    ).toMatchObject([{ id: first.jobId, kind: 'knowledgeImport' }]);
    expect(await db.outbox.count({ where: { ownerId: fixture.ownerId } })).toBe(
      1,
    );
    const conflict = await fixture.service.request(fixture.ownerId, {
      ...input,
      selection: { ...input.selection, maxBytes: 100 },
    });
    expect(conflict).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(
      await db.importRun.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
  });

  it('should isolate requests and all run controls by owner', async ({
    database: { db },
  }) => {
    const fixture = createImportFixture(
      db,
      createProviderFixture({ snapshots: [createSnapshot()] }),
    );
    const run = await requestRun(fixture);
    const other = randomUUID();

    for (const operation of [
      fixture.service.get,
      fixture.service.resume,
      fixture.service.cancel,
    ]) {
      expect(await operation(other, run.id)).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
    }
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'queued',
    });
  });

  it('should persist exact evidence and every image as an unsaved pending draft', async ({
    database: { db },
  }) => {
    const snapshot = createSnapshot();
    const adapter = createProviderFixture({ snapshots: [snapshot] });
    const fixture = createImportFixture(db, adapter);
    const run = await requestRun(fixture);

    expect(await fixture.handle(run.jobId)).toEqual({
      success: true,
      data: { settled: true },
    });
    const versions = await db.sourceVersions.findMany({
      where: { ownerId: fixture.ownerId },
    });
    const revisions = await db.knowledgeRevisions.findMany({
      where: { knowledgeEntries: { ownerId: fixture.ownerId } },
    });
    expect(versions).toHaveLength(1);
    expect(revisions).toMatchObject([
      { status: 'draft', savedBy: null, contentSchemaVersion: 2 },
    ]);
    expect(revisions[0]?.content).toMatchObject({
      origin: 'open_import',
      editorialReview: { state: 'pending' },
      citations: [
        expect.objectContaining({
          quote: '青花瓷瓶',
          locator: expect.objectContaining({
            kind: 'structured',
            fieldPath: '/title',
            excerpt: '青花瓷瓶',
          }),
          source: expect.objectContaining({ structuredSnapshot: snapshot }),
        }),
      ],
    });
    expect(
      (
        await db.referenceImages.findMany({
          where: { sourceVersions: { ownerId: fixture.ownerId } },
        })
      )
        .map(({ externalImageUrl }) => externalImageUrl)
        .sort(),
    ).toEqual(
      adapter
        .map(snapshot)
        .draft.images.map(({ imageUrl }) => imageUrl)
        .sort(),
    );
    expect(
      await db.knowledgeEntries.findMany({
        where: { ownerId: fixture.ownerId },
      }),
    ).toMatchObject([{ latestSavedRevision: null }]);
    expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
      status: 'completed',
      counts: { processed: 1, imported: 1 },
    });
  });

  it('should write no duplicate versions on replay or unchanged upstream payloads', async ({
    database: { db },
  }) => {
    const fixture = createImportFixture(
      db,
      createProviderFixture({ snapshots: [createSnapshot()] }),
    );
    const first = await requestRun(fixture);
    await fixture.handle(first.jobId);
    await fixture.handle(first.jobId);
    const recheck = await requestRun(fixture);
    await fixture.handle(recheck.jobId);

    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(
      await db.knowledgeRevisions.count({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      }),
    ).toBe(1);
    expect(
      await db.externalObject.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(await fixture.store.get(fixture.ownerId, recheck.id)).toMatchObject({
      counts: { unchanged: 1, imported: 0 },
    });
  });

  it('should pin changed evidence to a new pending draft and review diff without saving history', async ({
    database: { db },
  }) => {
    const original = createSnapshot();
    const changed = createSnapshot('object-1', '青花瓷罐');
    const adapter = createProviderFixture({
      snapshots: [original],
      outcomes: {
        'object-1': [
          { kind: 'snapshot', value: original },
          { kind: 'snapshot', value: changed },
        ],
      },
    });
    const fixture = createImportFixture(db, adapter);
    const first = await requestRun(fixture);
    await fixture.handle(first.jobId);
    const second = await requestRun(fixture);
    await fixture.handle(second.jobId);

    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(2);
    const revisions = await db.knowledgeRevisions.findMany({
      where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      orderBy: { revision: 'asc' },
    });
    expect(revisions).toMatchObject([
      { revision: 1, status: 'draft', savedBy: null },
      { revision: 2, status: 'draft', savedBy: null },
    ]);
    expect(
      await db.reviewDiff.findMany({ where: { importRunId: second.id } }),
    ).toMatchObject([
      {
        baseRevision: 1,
        candidateRevision: 2,
        status: 'pending',
        reviewedBy: null,
      },
    ]);
    expect(
      await db.knowledgeEntries.findMany({
        where: { ownerId: fixture.ownerId },
      }),
    ).toMatchObject([{ latestSavedRevision: null }]);
  });

  it('should preserve historical versions and record an observation when upstream disappears', async ({
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
    const recheck = await requestRun(fixture);
    await fixture.handle(recheck.jobId);

    expect(
      await db.externalObject.findMany({ where: { ownerId: fixture.ownerId } }),
    ).toMatchObject([{ status: 'missing' }]);
    expect(
      await db.sourceVersions.count({ where: { ownerId: fixture.ownerId } }),
    ).toBe(1);
    expect(
      await db.knowledgeRevisions.count({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      }),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await db.reviewDiff.count({ where: { importRunId: recheck.id } }),
    ).toBe(1);
  });
});
