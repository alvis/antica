import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createDatabase } from '../connection.js';
import { indexVersionId } from '../index-version.js';

import {
  canonicalViews,
  parseRuns,
  sourcePages,
  sourceRegions,
  indexVersions,
  sourceBlocks,
  jobs,
  knowledgeEntries,
  mediaAssets,
  referenceImages,
  sourceIntakes,
} from '../schema/index.js';
import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';

import {
  createSourceRepository,
  readReferenceImage,
  readSourceLocator,
} from './sources.js';

import type { ProviderChunkMapping } from '@antica/application/ports';
import type {
  Source,
  SourceVersion,
  SourcePage,
  SourceRegion,
  SourceCitation,
  ReferenceImage,
} from '@antica/domain';

const instant = '2026-10-13T00:00:00.000Z';

describe('fn:createSourceRepository', () => {
  it('should omit a region deleted after listing under read committed isolation', async () => {
    const database = await createIsolatedDatabase();
    const reader = createDatabase({ url: database.url, maxConnections: 1 });
    const { source, version } = sourcePair();
    const assetId = randomUUID();
    const pageId = randomUUID();
    const viewId = randomUUID();
    const parseRunId = randomUUID();
    const regionId = randomUUID();
    try {
      await database.db.transaction(async (tx) => {
        await createSourceRepository(tx, database.ownerId).create(
          source,
          version,
          [],
        );
        await tx.insert(mediaAssets).values({
          id: assetId,
          ownerId: database.ownerId,
          sourceVersionId: version.id,
          kind: 'document',
          purpose: 'book_file',
          state: 'ready',
          objectKey: `originals/${assetId}`,
          originalFileName: 'catalog.pdf',
          mimeType: 'application/pdf',
          byteLength: 10,
          sha256: 'a'.repeat(64),
        });
        await tx.insert(canonicalViews).values({
          id: viewId,
          originalAssetId: assetId,
          width: 100,
          height: 200,
          coordinateSpace: 'pdf_page_points',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        });
        await tx.insert(sourcePages).values({
          id: pageId,
          sourceVersionId: version.id,
          pageIndex: 0,
          originalAssetId: assetId,
          canonicalViewId: viewId,
          pdfPageIndex: 0,
        });
        await tx.insert(jobs).values({
          id: parseRunId,
          ownerId: database.ownerId,
          kind: 'sourceIngestion',
          resourceId: version.id,
          state: 'pending',
          stage: 'parse',
        });
        await tx.insert(parseRuns).values({
          id: parseRunId,
          sourceVersionId: version.id,
          jobId: parseRunId,
          provider: 'test',
          status: 'completed',
        });
        await tx.insert(sourceRegions).values({
          id: regionId,
          sourceVersionId: version.id,
          pageId,
          parseRunId,
          kind: 'figure',
          geometry: { kind: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        });
      });
      const before = await reader.db.transaction(async (tx) =>
        createSourceRepository(tx, database.ownerId).get(source.id),
      );
      expect(before?.regions).toMatchObject([{ id: regionId }]);
      reader.db.$client.options.debug = (_connection, query): void => {
        if (
          query.includes('from "source_regions"') &&
          query.includes('"source_regions"."id" =')
        ) {
          execFileSync(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              'import postgres from "postgres"; const client = postgres(process.argv[1], { max: 1, prepare: false }); try { await client.unsafe("delete from source_regions where id = $1", [process.argv[2]]); } finally { await client.end(); }',
              database.url,
              regionId,
            ],
            { cwd: new URL('../../../', import.meta.url), timeout: 10000 },
          );
        }
      };

      const result = await reader.db.transaction(async (tx) =>
        createSourceRepository(tx, database.ownerId).get(source.id),
      );

      expect(result).toMatchObject({
        source: { id: source.id },
        regions: [],
        pages: { items: [{ id: pageId }] },
      });
    } finally {
      await reader.close();
      await database.close();
    }
  });

  it('should resolve public index labels without treating them as UUID input', async () => {
    const database = await createIsolatedDatabase();
    const { source, version } = sourcePair();
    const parseRunId = randomUUID();
    const publicIndexVersion = 'test-v1';
    const persistedIndexId = indexVersionId(publicIndexVersion);
    try {
      await database.db.transaction(async (tx) => {
        const repository = createSourceRepository(tx, database.ownerId);
        expect(
          await repository.resolveProviderChunk(
            'llama-cloud',
            publicIndexVersion,
            'unmapped-file:0',
          ),
        ).toBeNull();
        await repository.create(source, version, []);
        await tx.insert(jobs).values({
          id: parseRunId,
          ownerId: database.ownerId,
          kind: 'sourceIngestion',
          resourceId: version.id,
          state: 'pending',
          stage: 'parse',
        });
        await tx.insert(parseRuns).values({
          id: parseRunId,
          sourceVersionId: version.id,
          jobId: parseRunId,
          provider: 'llama-cloud',
          status: 'completed',
        });
        const index = {
          indexVersion: publicIndexVersion,
          embeddingModelId: 'configured-model',
          dimensions: 64,
        };
        const mapping: ProviderChunkMapping = {
          provider: 'llama-cloud',
          providerChunkId: 'mapped-file:0',
          providerFigureId: null,
          parseRunId,
          indexVersion: publicIndexVersion,
          sourceVersionId: version.id,
          canonicalRegionIds: [],
        };
        await repository.addProviderChunkMappings(index, [mapping]);
        await repository.addProviderChunkMappings(index, [mapping]);
        expect(
          await tx
            .select({
              id: indexVersions.id,
              model: indexVersions.embeddingModelId,
              dimensions: indexVersions.dimensions,
              kind: indexVersions.kind,
            })
            .from(indexVersions)
            .where(eq(indexVersions.id, persistedIndexId)),
        ).toEqual([
          {
            id: persistedIndexId,
            model: 'configured-model',
            dimensions: 64,
            kind: 'text',
          },
        ]);
        await expect(
          repository.addProviderChunkMappings(
            { ...index, indexVersion: 'other-label' },
            [mapping],
          ),
        ).rejects.toThrow();
        await expect(
          repository.addProviderChunkMappings(
            { ...index, embeddingModelId: 'different-model' },
            [mapping],
          ),
        ).rejects.toThrow();
        await expect(
          repository.addProviderChunkMappings({ ...index, dimensions: 128 }, [
            mapping,
          ]),
        ).rejects.toThrow();
        const imageIndex = { ...index, indexVersion: 'image-only' };
        await tx.insert(indexVersions).values({
          id: indexVersionId(imageIndex.indexVersion),
          kind: 'image',
          embeddingModelId: index.embeddingModelId,
          dimensions: index.dimensions,
          status: 'active',
        });
        await expect(
          repository.addProviderChunkMappings(imageIndex, []),
        ).rejects.toThrow();

        expect(
          await repository.resolveProviderChunk(
            'llama-cloud',
            publicIndexVersion,
            'mapped-file:0',
          ),
        ).toEqual({
          provider: 'llama-cloud',
          providerChunkId: 'mapped-file:0',
          providerFigureId: null,
          parseRunId,
          indexVersion: publicIndexVersion,
          sourceVersionId: version.id,
          canonicalRegionIds: [],
        });
        expect(
          await repository.resolveProviderChunk(
            'llama-cloud',
            persistedIndexId,
            'mapped-file:0',
          ),
        ).toMatchObject({
          indexVersion: persistedIndexId,
          sourceVersionId: version.id,
        });
        expect(
          await createSourceRepository(tx, randomUUID()).resolveProviderChunk(
            'llama-cloud',
            publicIndexVersion,
            'mapped-file:0',
          ),
        ).toBeNull();
      });
    } finally {
      await database.close();
    }
  });

  it('should keep immutable metadata snapshots, compare-and-swap updates and job ordering scoped to the owner', async () => {
    const database = await createIsolatedDatabase();
    const { source, version } = sourcePair();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createSourceRepository(tx, database.ownerId);
        await repository.create(source, version, []);
        expect(await repository.getVersion(version.id)).toEqual(version);
        expect(await repository.findVersionByHash(version.sourceHash)).toEqual(
          version,
        );
        expect(await repository.findVersionByHash('absent')).toBeNull();
        expect(await repository.get(source.id)).toMatchObject({
          source,
          version,
          pages: { items: [], nextCursor: null },
          processingJobId: null,
        });
        expect(await repository.getIngestionJobId(version.id)).toBeNull();
        const firstJob = randomUUID();
        const lastJob = randomUUID();
        await tx.insert(jobs).values([
          {
            id: firstJob,
            ownerId: database.ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'queued',
            createdAt: instant,
          },
          {
            id: lastJob,
            ownerId: database.ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'queued',
            createdAt: '2026-10-14T00:00:00.000Z',
          },
        ]);
        expect(await repository.getIngestionJobId(version.id)).toBe(firstJob);
        expect((await repository.get(source.id))?.processingJobId).toBe(
          lastJob,
        );
        const second = {
          ...version,
          id: randomUUID(),
          sourceHash: 'b'.repeat(64),
          retrievedAt: instant,
          metadataSnapshot: {
            ...version.metadataSnapshot,
            title: 'Revised catalog',
            contributors: [
              {
                nameAsPrinted: 'Curator',
                role: 'editor' as const,
                attribution: 'as_printed' as const,
              },
            ],
            languages: ['en'],
          },
        };
        expect(await repository.addVersion(second, 1, [])).toBe(true);
        expect(
          await repository.addVersion({ ...second, id: randomUUID() }, 1, []),
        ).toBe(false);
        expect((await repository.get(source.id))?.source).toMatchObject({
          revision: 2,
          metadata: second.metadataSnapshot,
        });
        expect((await repository.get(source.id, version.id))?.version).toEqual(
          version,
        );
        expect(
          await repository.updateVersion(
            { ...second, status: 'processing' },
            'registered',
            null,
          ),
        ).toBe(true);
        expect(
          await repository.updateVersion(
            { ...second, status: 'ready' },
            'registered',
            null,
          ),
        ).toBe(false);
        const foreign = createSourceRepository(tx, randomUUID());
        expect(await foreign.get(source.id)).toBeNull();
        expect(await foreign.getVersion(version.id)).toBeNull();
        expect(await foreign.findVersionByHash(version.sourceHash)).toBeNull();
        expect(await foreign.getIngestionJobId(version.id)).toBeNull();
        expect(
          await foreign.addVersion({ ...second, id: randomUUID() }, 2, []),
        ).toBe(false);
        expect(await foreign.updateVersion(second, 'processing', null)).toBe(
          false,
        );
        expect(await repository.get(source.id, randomUUID())).toBeNull();
        const other = sourcePair();
        await repository.create(other.source, other.version, []);
        expect(await repository.get(source.id, other.version.id)).toBeNull();
        const entryId = randomUUID();
        await tx.insert(knowledgeEntries).values({
          id: entryId,
          ownerId: database.ownerId,
          displayCode: 'KN-1',
          currentRevision: 1,
        });
        await repository.linkKnowledgeDraft(version.id, entryId);
        await repository.linkKnowledgeDraft(version.id, entryId);
        expect(
          (await repository.get(source.id, version.id))?.knowledgeDraftIds,
        ).toEqual([entryId]);
        await expect(
          foreign.linkKnowledgeDraft(version.id, entryId),
        ).rejects.toThrow();
      });
    } finally {
      await database.close();
    }
  });

  it.each([undefined, { rotationQuarterTurns: 1 as const, crop: null }])(
    'should replay parsed pages, regions, citations and provider mappings without duplicating relationships with presentation %j',
    async (presentation) => {
      const database = await createIsolatedDatabase();
      const { source, version } = sourcePair();
      const assetId = randomUUID();
      const rawOutputAssetId = randomUUID();
      const intakeId = randomUUID();
      const parseRunId = randomUUID();
      const regionId = randomUUID();
      const figureId = randomUUID();
      const pages: SourcePage[] = [0, 1].map((pageIndex) => ({
        id: randomUUID(),
        sourceVersionId: version.id,
        pageIndex,
        printedPageLabel: `${pageIndex + 1}`,
        originalAssetId: assetId,
        pdfPageIndex: pageIndex,
        view: {
          id: randomUUID(),
          originalAssetId: assetId,
          derivativeId: null,
          width: 100,
          height: 200,
          originalCoordinateSpace: 'pdf_page_points',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        },
        presentation: presentation ?? null,
        rawText: 'Catalog text',
        searchText: 'Catalog text',
        quality: 'usable',
        regionIds: pageIndex === 0 ? [regionId, figureId] : [],
      }));
      const page = pages[0]!;
      const locator: SourceCitation['locator'] = {
        kind: 'page',
        sourceId: source.id,
        sourceVersionId: version.id,
        pageId: page.id,
        pageIndex: 0,
        printedPageLabel: '1',
        canonicalViewId: page.view.id,
        regionId,
        region: { kind: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
        textRange: null,
      };
      const regions: SourceRegion[] = [
        {
          id: regionId,
          sourceVersionId: version.id,
          pageId: page.id,
          kind: 'text',
          region: locator.region!,
          rawText: 'Catalog text',
          relatedRegionIds: [figureId],
        },
        {
          id: figureId,
          sourceVersionId: version.id,
          pageId: page.id,
          kind: 'figure',
          region: locator.region!,
          rawText: null,
          relatedRegionIds: [],
        },
      ];
      const image: ReferenceImage = {
        id: randomUUID(),
        sourceVersionId: version.id,
        locator,
        figureRegionId: figureId,
        storedDerivativeId: null,
        externalImageUrl: 'https://example.invalid/figure.jpg',
        originalCaption: { textAsPrinted: 'Figure one', locator },
        generatedDescriptionZhHant: null,
        descriptionJobId: null,
        captionAssociation: 'verified',
      };
      const uncaptioned = {
        ...image,
        id: randomUUID(),
        originalCaption: null,
        captionAssociation: 'none' as const,
      };
      const mapping: ProviderChunkMapping = {
        provider: 'test',
        providerChunkId: 'chunk-1',
        providerFigureId: null,
        parseRunId,
        indexVersion: randomUUID(),
        sourceVersionId: version.id,
        canonicalRegionIds: [regionId],
      };
      const pack = {
        sourceVersionId: version.id,
        parseRunId,
        rawOutputAssetId,
        pages,
        regions,
        images: [image, uncaptioned],
        mappings: [mapping],
        warnings: [],
      };
      try {
        await database.db.transaction(async (tx) => {
          const repository = createSourceRepository(tx, database.ownerId);
          await tx
            .insert(sourceIntakes)
            .values({ id: intakeId, ownerId: database.ownerId });
          await tx.insert(mediaAssets).values({
            id: assetId,
            ownerId: database.ownerId,
            sourceIntakeId: intakeId,
            kind: 'document',
            purpose: 'source_original',
            state: 'ready',
            objectKey: `originals/${assetId}`,
            originalFileName: 'catalog.pdf',
            mimeType: 'application/pdf',
            byteLength: 10,
            sha256: 'a'.repeat(64),
          });
          await repository.create(
            source,
            { ...version, originalAssetIds: [assetId] },
            [
              {
                assetId,
                order: 0,
                printedPageLabel: null,
                presentation,
              },
            ],
          );
          await tx.insert(mediaAssets).values({
            id: rawOutputAssetId,
            ownerId: database.ownerId,
            sourceVersionId: version.id,
            kind: 'document',
            purpose: 'source_parse_output',
            state: 'ready',
            objectKey: `parse/${rawOutputAssetId}`,
            originalFileName: 'parse.json',
            mimeType: 'application/json',
            byteLength: 10,
            sha256: 'b'.repeat(64),
          });
          await tx.insert(jobs).values({
            id: parseRunId,
            ownerId: database.ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'parse',
          });
          await tx
            .insert(indexVersions)
            .values({
              id: mapping.indexVersion,
              kind: 'text',
              embeddingModelId: 'test',
              dimensions: 8,
              status: 'ready',
            })
            .onConflictDoNothing();
          await repository.saveParsed({
            ...pack,
            warnings: [{ pageId: page.id, messageZhHant: 'Review page' }],
          });
          expect((await repository.get(source.id))?.regions).toEqual(
            expect.arrayContaining(regions),
          );
          expect(await repository.getPage(page.id)).toMatchObject({
            rawText: '',
            quality: 'needs_review',
            regionIds: [],
          });
          expect(
            await repository.updateVersion(
              { ...version, status: 'ready', activeParseRunId: parseRunId },
              'registered',
              null,
            ),
          ).toBe(true);
          await repository.saveParsed(pack);
          expect(
            await repository.updateVersion(
              { ...version, status: 'partial', activeParseRunId: parseRunId },
              'ready',
              parseRunId,
            ),
          ).toBe(true);
          expect(await repository.getPage(page.id)).toEqual(page);
          const first = await repository.get(
            source.id,
            undefined,
            undefined,
            undefined,
            1,
          );
          const second = await repository.get(
            source.id,
            undefined,
            undefined,
            first!.pages.nextCursor!,
            1,
          );
          expect(first?.pages.items.map(({ id }) => id)).toEqual([page.id]);
          expect(second?.pages).toEqual({
            items: [pages[1]],
            nextCursor: null,
          });
          expect(first?.regions).toEqual(expect.arrayContaining(regions));
          expect(first?.referenceImages).toEqual(
            expect.arrayContaining([image, uncaptioned]),
          );
          expect(
            (await repository.get(source.id, undefined, page.id))?.pages.items,
          ).toEqual([page]);
          expect(
            (await repository.get(source.id, undefined, randomUUID()))?.pages
              .items,
          ).toEqual([]);
          expect(await repository.getReadTargets(version.id)).toEqual([
            {
              assetOrDerivativeId: assetId,
              storageKey: `originals/${assetId}`,
            },
          ]);
          expect(
            await repository.getReadTargets(version.id, [page.id, page.id]),
          ).toEqual([
            {
              assetOrDerivativeId: assetId,
              storageKey: `originals/${assetId}`,
            },
          ]);
          expect(
            await repository.resolveProviderChunk(
              mapping.provider,
              mapping.indexVersion,
              mapping.providerChunkId,
            ),
          ).toEqual(mapping);
          await repository.addProviderChunkMappings(
            {
              indexVersion: mapping.indexVersion,
              embeddingModelId: 'test',
              dimensions: 8,
            },
            [{ ...mapping, providerChunkId: 'empty', canonicalRegionIds: [] }],
          );
          for (const changed of [
            { parseRunId: randomUUID() },
            { sourceVersionId: randomUUID() },
            { providerFigureId: 'different-figure' },
          ]) {
            await expect(
              repository.addProviderChunkMappings(
                {
                  indexVersion: mapping.indexVersion,
                  embeddingModelId: 'test',
                  dimensions: 8,
                },
                [{ ...mapping, ...changed }],
              ),
            ).rejects.toThrow();
          }
          await expect(
            repository.addProviderChunkMappings(
              {
                indexVersion: mapping.indexVersion,
                embeddingModelId: 'test',
                dimensions: 8,
              },
              [
                {
                  ...mapping,
                  providerChunkId: 'missing-version',
                  sourceVersionId: randomUUID(),
                },
              ],
            ),
          ).rejects.toThrow();
          const foreignReader = createSourceRepository(tx, randomUUID());
          expect(
            await foreignReader.getReadTargets(version.id, [page.id]),
          ).toEqual([]);
          expect(await foreignReader.getReadTargets(version.id)).toEqual([]);
          const foreign = sourcePair();
          const foreignOwner = randomUUID();
          const foreignRepository = createSourceRepository(tx, foreignOwner);
          await foreignRepository.create(foreign.source, foreign.version, []);
          const foreignCitation: SourceCitation = {
            id: randomUUID(),
            locator: {
              kind: 'web',
              sourceId: foreign.source.id,
              sourceVersionId: foreign.version.id,
              url: 'https://example.invalid/private',
              retrievedAt: instant,
              snapshotAssetId: null,
              blockId: null,
              excerptAsRetrieved: 'Private text',
            },
            relation: 'background',
            availability: 'link_only',
            verification: 'located',
          };
          await foreignRepository.addCitation(foreignCitation);
          const mismatchedImageId = randomUUID();
          await tx.insert(referenceImages).values({
            id: mismatchedImageId,
            sourceVersionId: version.id,
            locatorId: foreignCitation.id,
            captionAssociation: 'none',
          });
          expect(
            await readReferenceImage(tx, database.ownerId, mismatchedImageId),
          ).toBeNull();
          const blockId = randomUUID();
          await tx.insert(sourceBlocks).values({
            id: blockId,
            parseRunId,
            pageId: page.id,
            rawText: 'Catalog text',
            searchMapping: {},
            ordinal: 0,
          });
          const rangedCitation: SourceCitation = {
            id: randomUUID(),
            locator: { ...locator, textRange: { blockId, start: 0, end: 7 } },
            relation: 'supports',
            availability: 'stored',
            verification: 'located',
          };
          await repository.addCitation(rangedCitation);
          expect(await repository.getCitation(rangedCitation.id)).toEqual(
            rangedCitation,
          );
          await expect(
            repository.saveParsed({
              ...pack,
              pages: [{ ...page, originalAssetId: randomUUID() }],
              regions: [],
              images: [],
              mappings: [],
            }),
          ).rejects.toThrow();
          await expect(
            repository.saveParsed({
              ...pack,
              pages: [
                {
                  ...page,
                  pdfPageIndex: null,
                  view: { ...page.view, width: page.view.width + 1 },
                },
              ],
              regions: [],
              images: [],
              mappings: [],
            }),
          ).rejects.toThrow();
          const imagePage = { ...page, pdfPageIndex: null };
          await repository.saveParsed({
            ...pack,
            pages: [imagePage],
            regions: [],
            images: [],
            mappings: [],
          });
          expect((await repository.getPage(page.id))?.pdfPageIndex).toBeNull();
          const citation: SourceCitation = {
            id: randomUUID(),
            locator,
            relation: 'supports',
            availability: 'stored',
            verification: 'located',
          };
          await repository.addCitation(citation);
          await repository.addCitation(citation);
          expect(await repository.getCitation(citation.id)).toEqual(citation);
          expect(
            await readSourceLocator(tx, database.ownerId, citation.id),
          ).toEqual(locator);
          expect(
            await readReferenceImage(tx, database.ownerId, randomUUID()),
          ).toBeNull();
          expect(
            await readReferenceImage(tx, randomUUID(), image.id),
          ).toBeNull();
          expect(
            await createSourceRepository(tx, randomUUID()).getCitation(
              citation.id,
            ),
          ).toBeNull();
          await expect(
            createSourceRepository(tx, randomUUID()).addCitation(citation),
          ).rejects.toThrow();
          await expect(
            repository.addCitation({
              ...citation,
              id: randomUUID(),
              locator: { ...locator, sourceId: randomUUID() },
            }),
          ).rejects.toThrow();
        });
      } finally {
        await database.close();
      }
    },
  );

  it('should refuse to register an inaccessible original asset', async () => {
    const database = await createIsolatedDatabase();
    const { source, version } = sourcePair();
    try {
      await expect(
        database.db.transaction(async (tx) => {
          await createSourceRepository(tx, database.ownerId).create(
            source,
            version,
            [{ assetId: randomUUID(), order: 0, printedPageLabel: null }],
          );
        }),
      ).rejects.toThrow();
    } finally {
      await database.close();
    }
  });

  it('should reject malformed page cursors and return no inaccessible resources', async () => {
    const database = await createIsolatedDatabase();
    const { source, version } = sourcePair();
    try {
      await database.db.transaction(async (tx) => {
        const repository = createSourceRepository(tx, database.ownerId);
        await repository.create(source, version, []);
        for (const position of [
          { pageIndex: 0.5, id: randomUUID() },
          { pageIndex: -1, id: randomUUID() },
          { pageIndex: 0, id: 1 },
        ]) {
          const cursor = Buffer.from(JSON.stringify(position)).toString(
            'base64url',
          );
          await expect(
            repository.get(source.id, undefined, undefined, cursor),
          ).rejects.toThrow();
        }
        expect(await repository.getPage(randomUUID())).toBeNull();
        expect(await repository.getCitation(randomUUID())).toBeNull();
        expect(
          await repository.resolveProviderChunk(
            'provider',
            randomUUID(),
            'missing',
          ),
        ).toBeNull();
        expect(await repository.getReadTargets(version.id)).toEqual([]);
        expect(await repository.getReadTargets(version.id, [])).toEqual([]);
        expect(
          await repository.getReadTargets(version.id, [randomUUID()]),
        ).toEqual([]);
        await expect(
          repository.saveParsed({
            sourceVersionId: randomUUID(),
            parseRunId: randomUUID(),
            rawOutputAssetId: randomUUID(),
            pages: [],
            regions: [],
            images: [],
            mappings: [],
            warnings: [],
          }),
        ).rejects.toThrow();
      });
    } finally {
      await database.close();
    }
  });
});

function sourcePair(): {
  readonly source: Source;
  readonly version: SourceVersion;
} {
  const id = randomUUID();
  const versionId = randomUUID();
  const metadata = {
    title: 'Catalog',
    contributors: [],
    authorStatus: 'unknown' as const,
    editionStatement: null,
    publisher: null,
    publicationDateAsPrinted: null,
    isbn: null,
    languages: [],
    canonicalUrl: null,
    access: 'stored_copy' as const,
    rightsStatement: null,
    attributionText: null,
  };

  return {
    source: {
      id,
      revision: 1,
      createdAt: instant,
      updatedAt: instant,
      kind: 'book_pages',
      metadata,
      currentVersionId: versionId,
    },
    version: {
      id: versionId,
      sourceId: id,
      originalAssetIds: [],
      sourceHash: id.replaceAll('-', '').repeat(2),
      metadataSnapshot: metadata,
      capturedAt: instant,
      retrievedAt: null,
      status: 'registered',
      textIndexStatus: 'registered',
      imageIndexStatus: 'registered',
      activeParseRunId: null,
    },
  };
}
