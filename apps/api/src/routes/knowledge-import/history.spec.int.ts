import { describe, expect } from 'vitest';

import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';
import { createDatabase } from '@antica/platform/database';

import { createImportFixture, it, requestRun } from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type { KnowledgeProviderAdapter } from '@antica/contracts';

describe(
  'fn:createKnowledgeImportHandler:historical and overlapping evidence',
  { timeout: 60_000 },
  () => {
    it('should reuse an older payload version for A to B to A while adding a new unsaved review candidate', async ({
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
            { kind: 'snapshot', value: original },
          ],
        },
      });
      const fixture = createImportFixture(db, adapter);
      const first = await requestRun(fixture);
      await fixture.handle(first.jobId);
      const originalVersion = await db.sourceVersions.findFirstOrThrow({
        where: { ownerId: fixture.ownerId },
      });
      const second = await requestRun(fixture);
      await fixture.handle(second.jobId);
      const changedVersion = await db.sourceVersions.findFirstOrThrow({
        where: { ownerId: fixture.ownerId, payloadHash: changed.payloadHash },
      });
      const reverted = await requestRun(fixture);

      await fixture.handle(reverted.jobId);

      expect(
        await fixture.store.get(fixture.ownerId, reverted.id),
      ).toMatchObject({
        status: 'completed',
        counts: { imported: 1, failed: 0 },
      });
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
        { revision: 3, status: 'draft', savedBy: null },
      ]);
      const content = knowledgeContentEnvelopeV2Schema.parse(
        revisions[2]!.content,
      );
      expect(content.citations).toMatchObject([
        {
          source: { versionId: originalVersion.id },
          locator: { sourceVersionId: originalVersion.id, excerpt: '青花瓷瓶' },
        },
      ]);
      expect(
        await db.reviewDiff.findMany({ where: { importRunId: reverted.id } }),
      ).toMatchObject([
        {
          baseRevision: 2,
          candidateRevision: 3,
          oldSourceVersionId: changedVersion.id,
          newSourceVersionId: originalVersion.id,
          status: 'pending',
        },
      ]);
      expect(
        await db.knowledgeEntries.findMany({
          where: { ownerId: fixture.ownerId },
        }),
      ).toMatchObject([{ currentRevision: 3, latestSavedRevision: null }]);
    });

    it('should canonicalize distinct citation substrings to one field locator and preserve alternate image resolutions', async ({
      database: { db },
    }) => {
      const snapshot = createSnapshot('object-1', '青花瓷瓶，清代藏品');
      const base = createProviderFixture({ snapshots: [snapshot] });
      const adapter: KnowledgeProviderAdapter = {
        ...base,
        map: (captured) => {
          const mapped = base.map(captured);
          const original = mapped.draft.citations[0]!;
          const citation = {
            ...original,
            quote: '青花瓷瓶',
            locator: { ...original.locator, excerpt: '青花瓷瓶' },
          };
          const second = {
            ...citation,
            id: '00000000-0000-4000-8000-000000000002',
            quote: '清代藏品',
            locator: {
              ...citation.locator,
              excerpt: '清代藏品',
              id: '00000000-0000-4000-8000-000000000003',
            },
          };
          const citationIds = [citation.id, second.id];

          return {
            ...mapped,
            draft: {
              ...mapped.draft,
              citations: [citation, second],
              claims: mapped.draft.claims.map((claim) => ({
                ...claim,
                citationIds,
              })),
              sections: {
                ...mapped.draft.sections,
                summary: { ...mapped.draft.sections.summary, citationIds },
              },
              images: [
                ...mapped.draft.images,
                {
                  ...mapped.draft.images[0]!,
                  id: '00000000-0000-4000-8000-000000000004',
                  locatorId: second.locator.id,
                },
              ],
            },
          };
        },
      };
      const fixture = createImportFixture(db, adapter);
      const run = await requestRun(fixture);

      await fixture.handle(run.jobId);

      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 1, failed: 0 },
      });
      const locators = await db.sourceLocators.findMany({
        where: {
          sourceVersions: { ownerId: fixture.ownerId },
          kind: 'structured',
          fieldPath: '/title',
        },
      });
      expect(locators).toHaveLength(1);
      expect(locators[0]).toMatchObject({
        excerptAsRetrieved: '青花瓷瓶，清代藏品',
      });
      const images = await db.referenceImages.findMany({
        where: { sourceVersions: { ownerId: fixture.ownerId } },
      });
      expect(
        images.map(({ externalImageUrl }) => externalImageUrl).sort(),
      ).toEqual(
        base
          .map(snapshot)
          .draft.images.map(({ imageUrl }) => imageUrl)
          .sort(),
      );
      const revision = await db.knowledgeRevisions.findFirstOrThrow({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      });
      const content = knowledgeContentEnvelopeV2Schema.parse(revision.content);
      expect(content.citations).toHaveLength(2);
      expect(content.citations.map(({ quote }) => quote)).toEqual([
        '青花瓷瓶',
        '清代藏品',
      ]);
      expect(content.citations.map(({ locator }) => locator.excerpt)).toEqual([
        '青花瓷瓶，清代藏品',
        '青花瓷瓶，清代藏品',
      ]);
      expect(content.citations.map(({ locator }) => locator.id)).toEqual([
        locators[0]!.id,
        locators[0]!.id,
      ]);
      expect(images.every((image) => image.locatorId === locators[0]!.id)).toBe(
        true,
      );
    });

    it.for(['same', 'changed'] as const)(
      'should preserve identity and revisions when two %s payload batches overlap',
      async (variation, { database: { db, url } }) => {
        const barrier = Promise.withResolvers<void>();
        const arrivals: number[] = [];
        const onFetch = async (): Promise<void> => {
          arrivals.push(arrivals.length);
          if (arrivals.length === 2) {
            barrier.resolve();
          }
          await barrier.promise;
        };
        const firstAdapter = createProviderFixture({
          snapshots: [createSnapshot()],
          onFetch,
        });
        const secondAdapter = createProviderFixture({
          snapshots: [
            createSnapshot(
              'object-1',
              variation === 'same' ? '青花瓷瓶' : '青花瓷罐',
            ),
          ],
          onFetch,
        });
        const secondConnection = createDatabase({ url, maxConnections: 1 });
        try {
          const first = createImportFixture(db, firstAdapter);
          const second = {
            ...createImportFixture(secondConnection.db, secondAdapter),
            ownerId: first.ownerId,
          };
          const firstRun = await requestRun(first);
          const secondRun = await requestRun(second);

          await Promise.all([
            first.handle(firstRun.jobId),
            second.handle(secondRun.jobId),
          ]);

          expect(
            await first.store.get(first.ownerId, firstRun.id),
          ).toMatchObject({ status: 'completed', counts: { failed: 0 } });
          expect(
            await second.store.get(first.ownerId, secondRun.id),
          ).toMatchObject({ status: 'completed', counts: { failed: 0 } });
          expect(
            await db.externalObject.count({
              where: { ownerId: first.ownerId },
            }),
          ).toBe(1);
          expect(
            await db.sourceVersions.count({
              where: { ownerId: first.ownerId },
            }),
          ).toBe(variation === 'same' ? 1 : 2);
          const revisions = await db.knowledgeRevisions.findMany({
            where: { knowledgeEntries: { ownerId: first.ownerId } },
            orderBy: { revision: 'asc' },
          });
          expect(
            revisions.map(({ revision, status, savedBy }) => ({
              revision,
              status,
              savedBy,
            })),
          ).toEqual(
            variation === 'same'
              ? [{ revision: 1, status: 'draft', savedBy: null }]
              : [
                  { revision: 1, status: 'draft', savedBy: null },
                  { revision: 2, status: 'draft', savedBy: null },
                ],
          );
          expect(
            await db.importItem.count({
              where: { runId: { in: [firstRun.id, secondRun.id] } },
            }),
          ).toBe(2);
        } finally {
          await secondConnection.close();
        }
      },
    );
  },
);
