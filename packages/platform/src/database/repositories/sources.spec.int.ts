import { createHash, randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import { createDatabase } from '../connection.js';
import { indexVersionId } from '../index-version.js';

import { createDatabaseTest } from '../spec/fixtures/runner.js';

import {
  createSourceRepository,
  readReferenceImage,
  readSourceLocator,
} from './sources.js';
import {
  createStructuredSourceVersion,
  writeStructuredCitation,
} from './structured-sources.js';

import type { ProviderChunkMapping } from '@antica/application/ports';
import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type {
  Source,
  SourceVersion,
  SourcePage,
  SourceRegion,
  SourceCitation,
  ReferenceImage,
} from '@antica/domain';

import type { Transaction } from '../transaction.js';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.sources!);

const instant = '2026-10-13T00:00:00.000Z';

describe('fn:createSourceRepository', { timeout: 30_000 }, () => {
  it('should omit a region deleted after listing under read committed isolation', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const reader = createDatabase({ url: database.url, maxConnections: 1 });
    const { source, version } = sourcePair();
    const assetId = randomUUID();
    const pageId = randomUUID();
    const viewId = randomUUID();
    const parseRunId = randomUUID();
    const regionId = randomUUID();
    try {
      await database.db.$transaction(async (tx) => {
        await createSourceRepository(tx, ownerId).create(
          source,
          { ...version, activeParseRunId: parseRunId },
          [],
        );
        await tx.mediaAssets.createMany({
          data: {
            id: assetId,
            ownerId,
            sourceVersionId: version.id,
            kind: 'document',
            purpose: 'book_file',
            state: 'ready',
            objectKey: `originals/${assetId}`,
            originalFileName: 'catalog.pdf',
            mimeType: 'application/pdf',
            byteLength: 10,
            sha256: 'a'.repeat(64),
          },
        });
        await tx.canonicalViews.createMany({
          data: {
            id: viewId,
            originalAssetId: assetId,
            width: 100,
            height: 200,
            coordinateSpace: 'pdf_page_points',
            transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
        });
        await tx.sourcePages.createMany({
          data: {
            id: pageId,
            sourceVersionId: version.id,
            pageIndex: 0,
            originalAssetId: assetId,
            canonicalViewId: viewId,
            pdfPageIndex: 0,
          },
        });
        await tx.jobs.createMany({
          data: {
            id: parseRunId,
            ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'parse',
          },
        });
        await tx.parseRuns.createMany({
          data: {
            id: parseRunId,
            sourceVersionId: version.id,
            jobId: parseRunId,
            provider: 'test',
            status: 'completed',
          },
        });
        await tx.sourcePageParses.createMany({
          data: {
            parseRunId,
            pageId,
            rawText: '',
            searchText: '',
            quality: 'usable',
          },
        });
        await tx.sourceRegions.createMany({
          data: {
            id: regionId,
            sourceVersionId: version.id,
            pageId,
            parseRunId,
            kind: 'figure',
            geometry: { kind: 'rect', x: 0.1, y: 0.1, width: 0.2, height: 0.2 },
          },
        });
      });
      const before = await reader.db.$transaction(async (tx) =>
        createSourceRepository(tx, ownerId).get(source.id),
      );
      expect(before?.regions).toMatchObject([{ id: regionId }]);
      const observedReader = reader.db.$extends({
        query: {
          sourceRegions: {
            async findFirst({ args, query }) {
              await database.db.sourceRegions.deleteMany({
                where: { id: regionId },
              });

              return query(args);
            },
          },
        },
      });

      const result = await observedReader.$transaction(async (tx) =>
        createSourceRepository(tx as Transaction, ownerId).get(source.id),
      );

      expect(result).toMatchObject({
        source: { id: source.id },
        regions: [],
        pages: { items: [{ id: pageId }] },
      });
    } finally {
      await reader.close();
    }
  });

  it('should resolve public index labels without treating them as UUID input', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const { source, version } = sourcePair();
    const parseRunId = randomUUID();
    const publicIndexVersion = 'test-v1';
    const persistedIndexId = indexVersionId(publicIndexVersion);
    await database.db.$transaction(async (tx) => {
      const repository = createSourceRepository(tx, ownerId);
      expect(
        await repository.resolveProviderChunk(
          'llama-cloud',
          publicIndexVersion,
          'unmapped-file:0',
        ),
      ).toBeNull();
      await repository.create(source, version, []);
      await tx.jobs.createMany({
        data: {
          id: parseRunId,
          ownerId,
          kind: 'sourceIngestion',
          resourceId: version.id,
          state: 'pending',
          stage: 'parse',
        },
      });
      await tx.parseRuns.createMany({
        data: {
          id: parseRunId,
          sourceVersionId: version.id,
          jobId: parseRunId,
          provider: 'llama-cloud',
          status: 'completed',
        },
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
        await tx.indexVersions.findMany({
          select: {
            id: true,
            embeddingModelId: true,
            dimensions: true,
            kind: true,
          },
          where: { id: persistedIndexId },
        }),
      ).toEqual([
        {
          id: persistedIndexId,
          embeddingModelId: 'configured-model',
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
      await tx.indexVersions.createMany({
        data: {
          id: indexVersionId(imageIndex.indexVersion),
          kind: 'image',
          embeddingModelId: index.embeddingModelId,
          dimensions: index.dimensions,
          status: 'active',
        },
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
  });

  it('should keep immutable metadata snapshots, compare-and-swap updates and job ordering scoped to the owner', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const { source, version } = sourcePair();
    await database.db.$transaction(async (tx) => {
      const repository = createSourceRepository(tx, ownerId);
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
      await tx.jobs.createMany({
        data: [
          {
            id: firstJob,
            ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'queued',
            createdAt: instant,
          },
          {
            id: lastJob,
            ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'queued',
            createdAt: '2026-10-14T00:00:00.000Z',
          },
        ],
      });
      expect(await repository.getIngestionJobId(version.id)).toBe(firstJob);
      expect((await repository.get(source.id))?.processingJobId).toBe(lastJob);
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
      await tx.knowledgeEntries.createMany({
        data: {
          id: entryId,
          ownerId,
          displayCode: 'KN-1',
          currentRevision: 1,
        },
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
  });

  it.for([undefined, { rotationQuarterTurns: 1 as const, crop: null }])(
    'should replay parsed pages, regions, citations and provider mappings without duplicating relationships with presentation %j',
    async (presentation, { connection }) => {
      const database = connection;
      const ownerId = randomUUID();
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
      await database.db.$transaction(async (tx) => {
        const repository = createSourceRepository(tx, ownerId);
        await tx.sourceIntakes.createMany({ data: { id: intakeId, ownerId } });
        await tx.mediaAssets.createMany({
          data: {
            id: assetId,
            ownerId,
            sourceIntakeId: intakeId,
            kind: 'document',
            purpose: 'source_original',
            state: 'ready',
            objectKey: `originals/${assetId}`,
            originalFileName: 'catalog.pdf',
            mimeType: 'application/pdf',
            byteLength: 10,
            sha256: 'a'.repeat(64),
          },
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
        await tx.mediaAssets.createMany({
          data: {
            id: rawOutputAssetId,
            ownerId,
            sourceVersionId: version.id,
            kind: 'document',
            purpose: 'source_parse_output',
            state: 'ready',
            objectKey: `parse/${rawOutputAssetId}`,
            originalFileName: 'parse.json',
            mimeType: 'application/json',
            byteLength: 10,
            sha256: 'b'.repeat(64),
          },
        });
        await tx.jobs.createMany({
          data: {
            id: parseRunId,
            ownerId,
            kind: 'sourceIngestion',
            resourceId: version.id,
            state: 'pending',
            stage: 'parse',
          },
        });
        await tx.indexVersions.createMany({
          skipDuplicates: true,
          data: {
            id: mapping.indexVersion,
            kind: 'text',
            embeddingModelId: 'test',
            dimensions: 8,
            status: 'ready',
          },
        });
        await repository.saveParsed({
          ...pack,
          warnings: [{ pageId: page.id, messageZhHant: 'Review page' }],
        });
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
        expect((await repository.get(source.id))?.regions).toEqual(
          expect.arrayContaining(regions),
        );
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
        await tx.referenceImages.createMany({
          data: {
            id: mismatchedImageId,
            sourceVersionId: version.id,
            locatorId: foreignCitation.id,
            captionAssociation: 'none',
          },
        });
        expect(
          await readReferenceImage(tx, ownerId, mismatchedImageId),
        ).toBeNull();
        const blockId = randomUUID();
        await tx.sourceBlocks.createMany({
          data: {
            id: blockId,
            parseRunId,
            pageId: page.id,
            rawText: 'Catalog text',
            searchMapping: {},
            ordinal: 0,
          },
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
        await expect(
          repository.saveParsed({
            ...pack,
            pages: [{ ...page, pdfPageIndex: null }],
            regions: [],
            images: [],
            mappings: [],
          }),
        ).rejects.toThrow(Error);
        expect(await repository.getPage(page.id)).toEqual(page);
        await expect(
          repository.saveParsed({
            ...pack,
            pages: [],
            regions: [{ ...regions[0]!, rawText: 'Conflicting region text' }],
            images: [],
            mappings: [],
          }),
        ).rejects.toThrow(Error);
        expect(await repository.getPage(page.id)).toEqual(page);
        expect((await repository.get(source.id))?.regions).toEqual(
          first?.regions,
        );
        const imageAssetId = randomUUID();
        const imageDerivativeId = randomUUID();
        const imagePage: SourcePage = {
          ...page,
          id: randomUUID(),
          pageIndex: 2,
          originalAssetId: imageAssetId,
          pdfPageIndex: null,
          regionIds: [],
          view: {
            ...page.view,
            id: randomUUID(),
            originalAssetId: imageAssetId,
            derivativeId: imageDerivativeId,
            originalCoordinateSpace: 'image_pixels',
          },
        };
        await tx.mediaAssets.createMany({
          data: {
            id: imageAssetId,
            ownerId,
            sourceVersionId: version.id,
            kind: 'photo',
            purpose: 'source_original',
            state: 'ready',
            objectKey: `originals/${imageAssetId}`,
            originalFileName: 'page.jpg',
            mimeType: 'image/jpeg',
            byteLength: 10,
            sha256: 'c'.repeat(64),
          },
        });
        await tx.sourceVersionAssets.createMany({
          data: {
            versionId: version.id,
            assetId: imageAssetId,
            ordinal: 1,
          },
        });
        await tx.mediaDerivatives.createMany({
          data: {
            id: imageDerivativeId,
            ownerId,
            originalAssetId: imageAssetId,
            kind: 'canonical',
            objectKey: `derivatives/${imageDerivativeId}`,
            mimeType: 'image/jpeg',
            byteLength: 10,
            sha256: 'd'.repeat(64),
          },
        });
        await tx.canonicalViews.createMany({
          data: {
            id: imagePage.view.id,
            originalAssetId: imageAssetId,
            derivativeId: imageDerivativeId,
            width: imagePage.view.width,
            height: imagePage.view.height,
            coordinateSpace: imagePage.view.originalCoordinateSpace,
            transformToOriginal: imagePage.view.transformToOriginal,
          },
        });
        await repository.saveParsed({
          ...pack,
          pages: [imagePage],
          regions: [],
          images: [],
          mappings: [],
        });
        expect(
          (await repository.getPage(imagePage.id))?.pdfPageIndex,
        ).toBeNull();
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
        expect(await readSourceLocator(tx, ownerId, citation.id)).toEqual(
          locator,
        );
        expect(await readReferenceImage(tx, ownerId, randomUUID())).toBeNull();
        expect(await readReferenceImage(tx, randomUUID(), image.id)).toBeNull();
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
    },
  );

  it('should refuse to register an inaccessible original asset', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const { source, version } = sourcePair();
    await expect(
      database.db.$transaction(async (tx) => {
        await createSourceRepository(tx, ownerId).create(source, version, [
          { assetId: randomUUID(), order: 0, printedPageLabel: null },
        ]);
      }),
    ).rejects.toThrow();
  });

  it('should reject malformed page cursors and return no inaccessible resources', async ({
    connection,
  }) => {
    const database = connection;
    const ownerId = randomUUID();
    const { source, version } = sourcePair();
    await database.db.$transaction(async (tx) => {
      const repository = createSourceRepository(tx, ownerId);
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

describe('fn:createStructuredSourceVersion', () => {
  it('should deduplicate exact snapshots while keeping identical records from distinct provider identities separate', async ({
    connection,
  }) => {
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const payload = { count: 3, title: 'Vase' };
    const payloadHash = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    const snapshot = {
      provider: 'museum',
      objectId: 'object-1',
      payloadHash,
      schemaVersion: '1',
      sourceHash: createHash('sha256')
        .update(
          JSON.stringify({
            objectId: 'object-1',
            payloadHash,
            provider: 'museum',
            schemaVersion: '1',
          }),
        )
        .digest('hex'),
      sourcePageUrl: 'https://museum.example/1',
      retrievedAt: instant,
      payload,
    };
    await connection.db.$transaction(async (tx) => {
      await tx.sources.create({
        data: {
          id: sourceId,
          ownerId,
          kind: 'structured_open_data',
          title: 'Museum object',
          authorStatus: 'unknown',
          access: 'link_only',
        },
      });
      await tx.sourceLanguages.create({ data: { sourceId, language: 'en' } });
      await tx.sourceContributors.create({
        data: {
          sourceId,
          ordinal: 0,
          nameAsPrinted: 'Museum',
          role: 'institution',
          attribution: 'as_printed',
        },
      });
      const id = randomUUID();
      expect(
        await createStructuredSourceVersion(tx, ownerId, {
          id,
          sourceId,
          snapshot,
        }),
      ).toBe(id);
      expect(
        await createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId,
          snapshot,
        }),
      ).toBe(id);
      expect(await tx.sourceVersions.count({ where: { sourceId } })).toBe(1);
      const citationId = randomUUID();
      const citation: KnowledgeContentEnvelopeV2['citations'][number] = {
        id: citationId,
        relation: 'supports',
        availability: 'link_only',
        verification: 'located',
        quote: 'Vase',
        locator: {
          kind: 'structured',
          id: citationId,
          sourceId,
          sourceVersionId: id,
          provider: 'museum',
          objectId: 'object-1',
          fieldPath: '/title',
          valueHash: createHash('sha256')
            .update(JSON.stringify('Vase'))
            .digest('hex'),
          url: snapshot.sourcePageUrl,
          retrievedAt: instant,
          excerpt: 'Vase',
        },
        source: {
          id: sourceId,
          versionId: id,
          title: 'Museum object',
          canonicalUrl: snapshot.sourcePageUrl,
          languages: ['en'],
          contributors: ['Museum'],
          structuredSnapshot: snapshot,
        },
      };
      await writeStructuredCitation(tx, ownerId, citation);
      await writeStructuredCitation(tx, ownerId, citation);
      const countCitationId = randomUUID();
      const countCitation = {
        ...citation,
        id: countCitationId,
        quote: '3',
        locator: {
          ...citation.locator,
          id: countCitationId,
          fieldPath: '/count',
          valueHash: createHash('sha256').update('3').digest('hex'),
          excerpt: '3',
        },
      };
      await writeStructuredCitation(tx, ownerId, countCitation);
      expect(
        await tx.citations.findUnique({ where: { id: countCitationId } }),
      ).toMatchObject({ locatorId: countCitationId });
      if (citation.locator.kind !== 'structured') {
        throw new Error('Expected structured fixture');
      }
      const capturedLocator = citation.locator;
      for (const forged of [
        { provider: 'different-museum' },
        { objectId: 'different-object' },
        { url: 'https://museum.example/forged' },
        { retrievedAt: '2026-01-01T00:00:00.000Z' },
      ]) {
        await tx.sourceLocators.update({
          where: { id: citationId },
          data: forged,
        });
        await expect(
          writeStructuredCitation(tx, ownerId, {
            ...citation,
            locator: { ...capturedLocator, ...forged },
          }),
        ).rejects.toThrow();
        await tx.sourceLocators.update({
          where: { id: citationId },
          data: {
            provider: capturedLocator.provider,
            objectId: capturedLocator.objectId,
            url: capturedLocator.url,
            retrievedAt: capturedLocator.retrievedAt,
          },
        });
      }

      expect(await tx.citations.count({ where: { id: citationId } })).toBe(1);
      expect(
        await tx.sourceLocators.findUnique({ where: { id: citationId } }),
      ).toMatchObject({
        fieldPath: '/title',
        valueHash: citation.locator.valueHash,
        sourceVersionId: id,
      });
      await expect(
        writeStructuredCitation(tx, randomUUID(), citation),
      ).rejects.toThrow();
      for (const invalidSnapshot of [
        { ...snapshot, payload: { title: 'Forged title' } },
        { ...snapshot, payloadHash: 'f'.repeat(64) },
        { ...snapshot, provider: 'forged' },
        { ...snapshot, sourcePageUrl: 'https://museum.example/forged' },
        { ...snapshot, retrievedAt: '2026-01-01T00:00:00.000Z' },
        {
          ...snapshot,
          observedRights: [
            {
              name: 'PDM',
              observedAt: instant,
              evidenceUrl: 'https://museum.example/rights',
            },
          ],
        },
        { ...snapshot, sourceHash: 'f'.repeat(64) },
      ]) {
        await expect(
          writeStructuredCitation(tx, ownerId, {
            ...citation,
            source: { ...citation.source, structuredSnapshot: invalidSnapshot },
          }),
        ).rejects.toThrow();
      }

      await expect(
        writeStructuredCitation(tx, ownerId, {
          ...citation,
          quote: 'Forged quote',
        }),
      ).rejects.toThrow();
      await expect(
        writeStructuredCitation(tx, ownerId, {
          ...citation,
          locator: {
            kind: 'web',
            id: citationId,
            sourceId,
            sourceVersionId: id,
            url: snapshot.sourcePageUrl,
            retrievedAt: instant,
            section: 'Title',
            excerpt: 'Vase',
          },
        }),
      ).rejects.toThrow(TypeError);
      const secondSnapshot = {
        ...snapshot,
        objectId: 'object-2',
        sourceHash: createHash('sha256')
          .update(
            JSON.stringify({
              objectId: 'object-2',
              payloadHash,
              provider: 'museum',
              schemaVersion: '1',
            }),
          )
          .digest('hex'),
      };
      const secondId = randomUUID();
      const secondSourceId = randomUUID();
      await tx.sources.create({
        data: {
          id: secondSourceId,
          ownerId,
          kind: 'structured_open_data',
          title: 'Second object',
          authorStatus: 'unknown',
          access: 'link_only',
        },
      });
      await expect(
        createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId: secondSourceId,
          snapshot,
        }),
      ).rejects.toThrow();
      const changedPayload = { title: 'Updated vase' };
      const changedPayloadHash = createHash('sha256')
        .update(JSON.stringify(changedPayload))
        .digest('hex');
      await expect(
        createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId: secondSourceId,
          snapshot: {
            ...snapshot,
            payload: changedPayload,
            payloadHash: changedPayloadHash,
            sourceHash: createHash('sha256')
              .update(
                JSON.stringify({
                  objectId: snapshot.objectId,
                  payloadHash: changedPayloadHash,
                  provider: snapshot.provider,
                  schemaVersion: snapshot.schemaVersion,
                }),
              )
              .digest('hex'),
          },
        }),
      ).rejects.toThrow();
      expect(
        await createStructuredSourceVersion(tx, ownerId, {
          id: secondId,
          sourceId: secondSourceId,
          snapshot: secondSnapshot,
        }),
      ).toBe(secondId);
      expect(
        await tx.sourceVersions.findMany({
          where: { ownerId },
          orderBy: { id: 'asc' },
          select: { structuredPayload: true, payloadHash: true },
        }),
      ).toEqual([
        { structuredPayload: payload, payloadHash },
        { structuredPayload: payload, payloadHash },
      ]);
      await expect(
        createStructuredSourceVersion(tx, randomUUID(), {
          id: randomUUID(),
          sourceId,
          snapshot,
        }),
      ).rejects.toThrow();
      await expect(
        createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId,
          snapshot: { ...snapshot, payload: { imageBase64: 'aGVsbG8=' } },
        }),
      ).rejects.toThrow();
      await expect(
        createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId,
          snapshot: { ...snapshot, payload: { title: 'Changed' } },
        }),
      ).rejects.toThrow();
      await expect(
        createStructuredSourceVersion(tx, ownerId, {
          id: randomUUID(),
          sourceId,
          snapshot: { ...snapshot, sourceHash: 'f'.repeat(64) },
        }),
      ).rejects.toThrow();
      expect(await tx.sourceVersions.count({ where: { ownerId } })).toBe(2);
    });
  });
});
