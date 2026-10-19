import { describe, expect } from 'vitest';

import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import { createImportFixture, it, requestRun } from './fixtures/database.js';
import { createProviderFixture, createSnapshot } from './fixtures/provider.js';

import type { MappedObject } from '@antica/contracts';

const extraSections = [
  'history',
  'features',
  'applicability',
  'limits',
] as const;

describe(
  'fn:createKnowledgeImportHandler:source projections',
  { timeout: 60_000 },
  () => {
    it('should persist contributors, aliases, every cited section and root-located image metadata', async ({
      database: { db },
    }) => {
      const snapshot = createSnapshot();
      const base = createProviderFixture({ snapshots: [snapshot] });
      const fixture = createImportFixture(db, {
        ...base,
        map: (captured) => enrich(base.map(captured)),
      });
      const run = await requestRun(fixture);
      expect(await fixture.handle(run.jobId)).toEqual({
        success: true,
        data: { settled: true },
      });
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'completed',
        counts: { imported: 1 },
      });
      const revision = await db.knowledgeRevisions.findFirstOrThrow({
        where: { knowledgeEntries: { ownerId: fixture.ownerId } },
      });
      const content = knowledgeContentEnvelopeV2Schema.parse(revision.content);
      const citationId = content.citations[0]!.id;
      expect(content.claims).toHaveLength(5);
      for (const section of extraSections) {
        expect(content.sections[section]).toMatchObject([
          { claimKey: section, citationIds: [citationId] },
        ]);
      }
      expect(
        await db.sourceContributors.findMany({
          where: { sources: { ownerId: fixture.ownerId } },
        }),
      ).toMatchObject([
        {
          nameAsPrinted: 'Fixture Museum',
          role: 'institution',
          attribution: 'as_printed',
        },
      ]);
      expect(
        await db.knowledgeRevisionAliases.findMany({
          where: { entryId: revision.entryId },
        }),
      ).toMatchObject([{ alias: 'Blue and white vase' }]);
      const images = await db.referenceImages.findMany({
        where: { sourceVersions: { ownerId: fixture.ownerId } },
      });
      expect(images).toHaveLength(3);
      expect(images).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            width: 800,
            height: 600,
            providerImageId: 'front',
            status: 'available',
          }),
        ]),
      );
      const locators = await db.sourceLocators.findMany({
        where: { sourceVersions: { ownerId: fixture.ownerId } },
      });
      expect(locators).toHaveLength(1);
      expect(locators[0]).toMatchObject({
        fieldPath: '',
        valueHash: snapshot.payloadHash,
      });
      expect(images.every((image) => image.locatorId === locators[0]!.id)).toBe(
        true,
      );
    });

    it.for(['method', 'foreign-topic', 'foreign-entry'] as const)(
      'should roll back an import that attaches a %s association',
      async (variation, { database: { db } }) => {
        const base = createProviderFixture({ snapshots: [createSnapshot()] });
        const forbiddenId = '00000000-0000-4000-8000-000000000099';
        const fixture = createImportFixture(db, {
          ...base,
          map: (snapshot) => {
            const mapped = base.map(snapshot);

            return {
              ...mapped,
              draft: {
                ...mapped.draft,
                methodIds: variation === 'method' ? [forbiddenId] : [],
                topics:
                  variation === 'foreign-topic'
                    ? [{ topicId: forbiddenId, applicability: 'general' }]
                    : [],
                relatedEntryIds:
                  variation === 'foreign-entry' ? [forbiddenId] : [],
              },
            };
          },
        });
        const run = await requestRun(fixture);
        await expect(fixture.handle(run.jobId)).rejects.toThrow(
          'not owner scoped',
        );
        expect(
          await db.sourceVersions.count({
            where: { ownerId: fixture.ownerId },
          }),
        ).toBe(0);
        expect(await db.importItem.count({ where: { runId: run.id } })).toBe(0);
        expect(
          await db.knowledgeRevisions.count({
            where: { knowledgeEntries: { ownerId: fixture.ownerId } },
          }),
        ).toBe(0);
      },
    );

    it('should require restart for a persisted checkpoint schema incompatible with the current worker', async ({
      database: { db },
    }) => {
      const base = createProviderFixture({ snapshots: [createSnapshot()] });
      const fixture = createImportFixture(db, base);
      const run = await requestRun(fixture);
      const lease = await fixture.store.claim(run.jobId);
      if (!lease) {
        throw new Error('Expected fixture lease');
      }
      await db.importRun.update({
        where: { id: run.id },
        data: { cursor: { ...lease.checkpoint, schemaVersion: 1 } },
      });
      expect(
        await fixture.service.resume(fixture.ownerId, run.id),
      ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
      fixture.clock.value = '2026-10-19T00:00:02.000Z';
      await fixture.handle(run.jobId);
      expect(base.fetched).toEqual([]);
      expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
        status: 'partial',
        reason: 'RESTART_REQUIRED',
      });
    });
  },
);

/**
 * adds representative metadata and cited sections without changing captured evidence
 * @param mapped deterministic provider aggregate
 * @returns rich provider output with a single root JSON citation
 */
function enrich(mapped: MappedObject): MappedObject {
  const snapshot = mapped.source.structuredSnapshot!;
  const source = { ...mapped.source, contributors: ['Fixture Museum'] };
  const first = mapped.draft.citations[0]!;
  if (first.locator.kind !== 'structured') {
    throw new Error('Expected structured fixture locator');
  }
  const citation = {
    ...first,
    source,
    locator: {
      ...first.locator,
      fieldPath: '',
      valueHash: snapshot.payloadHash,
      excerpt: first.quote,
    },
  };
  const node = mapped.draft.sections.summary;
  const claim = mapped.draft.claims[0]!;

  return {
    ...mapped,
    source,
    externalObject: {
      ...mapped.externalObject,
      upstreamModifiedAt: snapshot.retrievedAt,
    },
    draft: {
      ...mapped.draft,
      aliases: [{ language: 'en', text: 'Blue and white vase' }],
      citations: [citation],
      sections: {
        summary: node,
        history: [{ ...node, claimKey: 'history' }],
        features: [{ ...node, claimKey: 'features' }],
        applicability: [{ ...node, claimKey: 'applicability' }],
        limits: [{ ...node, claimKey: 'limits' }],
      },
      claims: [
        claim,
        ...extraSections.map((section) => ({
          ...claim,
          claimKey: section,
          section,
        })),
      ],
      images: mapped.draft.images.map(
        ({ locatorId: _locatorId, ...image }) => ({
          ...image,
          width: 800,
          height: 600,
          providerImageId: 'front',
          status: 'available',
          lastCheckedAt: snapshot.retrievedAt,
          observedRights: {
            statement: 'Fixture rights',
            observedAt: snapshot.retrievedAt,
            evidenceUrl: snapshot.sourcePageUrl,
          },
        }),
      ),
    },
  };
}

describe(
  'fn:createKnowledgeImportHandler:captured web evidence',
  { timeout: 60_000 },
  () => {
    it.for(['exact', 'forged', 'section'] as const)(
      'should accept only captured web text without unsupported blocks for %s excerpts',
      async (variation, { database: { db } }) => {
        const base = createProviderFixture({ snapshots: [createSnapshot()] });
        const fixture = createImportFixture(db, {
          ...base,
          map: (snapshot) => {
            const mapped = base.map(snapshot);

            return {
              ...mapped,
              draft: {
                ...mapped.draft,
                citations: mapped.draft.citations.map((citation) => ({
                  ...citation,
                  quote:
                    variation === 'forged'
                      ? 'Fabricated catalogue description'
                      : citation.quote,
                  locator: {
                    id: citation.locator.id,
                    sourceId: mapped.source.id,
                    sourceVersionId: mapped.source.versionId,
                    kind: 'web',
                    url: snapshot.sourcePageUrl,
                    retrievedAt: snapshot.retrievedAt,
                    excerpt:
                      variation === 'forged'
                        ? 'Fabricated catalogue description'
                        : citation.quote,
                    ...(variation === 'section'
                      ? { section: 'unsupported-block' }
                      : {}),
                  },
                })),
              },
            };
          },
        });
        const run = await requestRun(fixture);
        await fixture.handle(run.jobId);
        if (variation !== 'exact') {
          expect(
            await db.importItem.findMany({ where: { runId: run.id } }),
          ).toMatchObject([{ errorCode: 'PERMANENT:INVALID_MAPPING' }]);
          expect(
            await db.sourceVersions.count({
              where: { ownerId: fixture.ownerId },
            }),
          ).toBe(0);

          return;
        }
        expect(await fixture.store.get(fixture.ownerId, run.id)).toMatchObject({
          status: 'completed',
          counts: { imported: 1 },
        });
        expect(
          await db.sourceLocators.findMany({
            where: {
              sourceVersions: { ownerId: fixture.ownerId },
              kind: 'web',
            },
          }),
        ).toMatchObject([
          {
            excerptAsRetrieved: '青花瓷瓶',
            url: 'https://catalog.example.invalid/object-1',
            blockId: null,
          },
        ]);
      },
    );
  },
);
