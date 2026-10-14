import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';

import { describe, expect, inject } from 'vitest';

import { createLocalMediaStore } from '../storage/local.js';

import { createRetrievalReaders } from './retrieval.js';
import {
  canonicalViews,
  citations,
  evidenceAnchors,
  jobs,
  knowledgeEntries,
  knowledgeRevisions,
  mediaAssets,
  mediaDerivatives,
  parseRuns,
  recordCategories,
  recordMaterials,
  records,
  referenceImages,
  sourceBlocks,
  sourceContributors,
  sourceKnowledgeDrafts,
  sourceLocators,
  sourcePageParses,
  sourcePages,
  sourceRegions,
  sources,
  sourceVersionAssets,
  sourceVersions,
} from './schema/index.js';
import { createDatabaseTest } from './spec/fixtures/runner.js';
import { createTransactionPort } from './transaction.js';

import type {
  KnowledgeContent,
  SourceCitation,
  SourceMetadata,
} from '@antica/domain';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources.retrieval!);

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL ?? '';
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated database',
  );
}

describe('fn:createRetrievalReaders', () => {
  it('should return no entries or query pixels for an owner with no persisted collection or sources', async ({
    connection,
  }) => {
    const database = connection;
    const root = await mkdtemp(join(tmpdir(), 'antica-retrieval-'));
    try {
      const readers = createRetrievalReaders({
        db: database.db,
        transaction: createTransactionPort(database.db),
        storage: createLocalMediaStore({
          root,
          publicBaseUrl: 'http://localhost:8080',
          signingSecret: 'retrieval-test-signing-secret-32-characters',
        }),
        ownerId: randomUUID(),
      });
      expect(await readers.readImageEntries()).toEqual([]);
      expect(await readers.readTextEntries()).toEqual([]);
      await expect(readers.readQuery(randomUUID())).rejects.toThrow(Error);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should retrieve authorized collection pixels and filters from durable canonical views', async ({
    connection,
  }) => {
    const database = connection;
    const root = await mkdtemp(join(tmpdir(), 'antica-retrieval-collection-'));
    const storage = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'retrieval-test-signing-secret-32-characters',
    });
    const ownerId = randomUUID();
    const recordId = randomUUID();
    const assetId = randomUUID();
    const derivativeId = randomUUID();
    const viewId = randomUUID();
    const anchorId = randomUUID();
    const categoryId = randomUUID();
    const materialId = randomUUID();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `derivatives/${assetId}/${derivativeId}`;
    const region = {
      kind: 'rect' as const,
      x: 0.1,
      y: 0.2,
      width: 0.5,
      height: 0.4,
    };
    try {
      await database.db.insert(records).values({
        id: recordId,
        ownerId,
        code: `TEST-${recordId}`,
        unitKind: 'single',
      });
      await database.db
        .insert(recordCategories)
        .values({ recordId, categoryId });
      await database.db
        .insert(recordMaterials)
        .values({ recordId, materialId });
      await database.db.insert(mediaAssets).values({
        id: assetId,
        ownerId,
        recordId,
        kind: 'photo',
        purpose: 'object',
        state: 'ready',
        objectKey: `originals/${assetId}`,
        originalFileName: 'object.png',
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(mediaDerivatives).values({
        id: derivativeId,
        ownerId,
        originalAssetId: assetId,
        kind: 'canonical',
        objectKey: key,
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(canonicalViews).values({
        id: viewId,
        originalAssetId: assetId,
        derivativeId,
        width: 100,
        height: 100,
        coordinateSpace: 'image_pixels',
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
      await database.db.insert(evidenceAnchors).values({
        id: anchorId,
        ownerId,
        recordId,
        originalAssetId: assetId,
        canonicalViewId: viewId,
        kind: 'photo',
        scopeKind: 'region',
        region,
      });
      await storage.writeDerivative({ key, bytes, mimeType: 'image/png' });
      const readers = createRetrievalReaders({
        db: database.db,
        transaction: createTransactionPort(database.db),
        storage,
        ownerId,
      });
      const foreign = createRetrievalReaders({
        db: database.db,
        transaction: createTransactionPort(database.db),
        storage,
        ownerId: randomUUID(),
      });

      expect(await readers.readQuery(anchorId)).toEqual({
        originalAssetId: assetId,
        canonicalViewId: viewId,
        bytes,
        region,
      });
      await expect(foreign.readQuery(anchorId)).rejects.toThrow(Error);
      expect(await readers.readImageEntries()).toEqual([
        {
          image: {
            originalAssetId: assetId,
            canonicalViewId: viewId,
            bytes,
            region: null,
          },
          match: {
            ref: { kind: 'collection', recordId, originalAssetId: assetId },
            matchingRegions: [
              { canonicalViewId: viewId, region: null, derivativeId: null },
            ],
            thumbnail: null,
            sourceLocator: null,
            sourceTitle: null,
            contributorNames: [],
            warningsZhHant: [],
          },
          filterIds: {
            objectTypeIds: [categoryId],
            materialIds: [materialId],
            periodIds: [],
            regionIds: [],
            sourceIds: [],
          },
        },
      ]);
      expect(await foreign.readImageEntries()).toEqual([]);
      await database.db
        .update(evidenceAnchors)
        .set({ scopeKind: 'whole', region: null })
        .where(eq(evidenceAnchors.id, anchorId));
      expect(await readers.readQuery(anchorId)).toEqual({
        originalAssetId: assetId,
        canonicalViewId: viewId,
        bytes,
        region: null,
      });
      const additional = Array.from({ length: 200 }, () => ({
        assetId: randomUUID(),
        derivativeId: randomUUID(),
        viewId: randomUUID(),
      }));
      await database.db.insert(mediaAssets).values(
        additional.map((item) => ({
          id: item.assetId,
          ownerId,
          recordId,
          kind: 'photo',
          purpose: 'object',
          state: 'ready',
          objectKey: `originals/${item.assetId}`,
          originalFileName: 'collection.png',
          mimeType: 'image/png',
          byteLength: bytes.byteLength,
          sha256,
        })),
      );
      await database.db.insert(mediaDerivatives).values(
        additional.map((item) => ({
          id: item.derivativeId,
          ownerId,
          originalAssetId: item.assetId,
          kind: 'canonical',
          objectKey: `derivatives/${item.assetId}/${item.derivativeId}`,
          mimeType: 'image/png',
          byteLength: bytes.byteLength,
          sha256,
        })),
      );
      await database.db.insert(canonicalViews).values(
        additional.map((item) => ({
          id: item.viewId,
          originalAssetId: item.assetId,
          derivativeId: item.derivativeId,
          width: 100,
          height: 100,
          coordinateSpace: 'image_pixels',
          transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
        })),
      );
      for (const item of additional) {
        await storage.writeDerivative({
          key: `derivatives/${item.assetId}/${item.derivativeId}`,
          bytes,
          mimeType: 'image/png',
        });
      }
      const allImages = await readers.readImageEntries();
      expect(allImages.map((item) => item.image.canonicalViewId)).toEqual(
        [viewId, ...additional.map((item) => item.viewId)].sort(),
      );
      expect(
        allImages.every((item) => Buffer.from(item.image.bytes).equals(bytes)),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('should retain source version, page region, contributor and citation provenance in reference and text retrieval', async ({
    connection,
  }) => {
    const database = connection;
    const root = await mkdtemp(join(tmpdir(), 'antica-retrieval-source-'));
    const storage = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'retrieval-test-signing-secret-32-characters',
    });
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const parseRunId = randomUUID();
    const assetId = randomUUID();
    const derivativeId = randomUUID();
    const viewId = randomUUID();
    const pageId = randomUUID();
    const regionId = randomUUID();
    const locatorId = randomUUID();
    const citationId = randomUUID();
    const imageId = randomUUID();
    const entryId = randomUUID();
    const now = '2026-10-13T04:00:00.000Z';
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 2]);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const key = `derivatives/${assetId}/${derivativeId}`;
    const region = {
      kind: 'rect' as const,
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.4,
    };
    const metadata: SourceMetadata = {
      title: 'Reference catalogue',
      contributors: [
        {
          nameAsPrinted: 'Curator A',
          role: 'author',
          attribution: 'as_printed',
        },
      ],
      authorStatus: 'named',
      editionStatement: null,
      publisher: null,
      publicationDateAsPrinted: null,
      isbn: null,
      languages: ['en'],
      canonicalUrl: null,
      access: 'stored_copy',
      rightsStatement: null,
      attributionText: null,
    };
    const pageCitation: SourceCitation = {
      id: citationId,
      locator: {
        kind: 'page',
        sourceId,
        sourceVersionId,
        pageId,
        pageIndex: 0,
        printedPageLabel: '1',
        canonicalViewId: viewId,
        regionId,
        region,
        textRange: null,
      },
      relation: 'background',
      availability: 'stored',
      verification: 'located',
    };
    const webCitation = {
      id: randomUUID(),
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId,
        url: 'https://example.org/catalogue',
        retrievedAt: now,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: 'Online catalogue note',
      },
      relation: 'background',
      availability: 'link_only',
      verification: 'located',
    } satisfies SourceCitation;
    const content: KnowledgeContent = {
      titleZhHant: '目錄',
      aliases: [],
      kinds: ['surface'],
      otherKindLabel: null,
      summary: {
        textZhHant: '描述釉面',
        citationIds: [citationId],
        support: 'cited',
      },
      history: [],
      features: [],
      applicability: [],
      exampleReferenceImageIds: [],
      relatedEntryIds: [],
      citations: [pageCitation, webCitation],
    };
    try {
      await database.db.insert(sources).values({
        id: sourceId,
        ownerId,
        kind: 'book_pages',
        currentVersionId: sourceVersionId,
        title: metadata.title,
        authorStatus: metadata.authorStatus,
        access: metadata.access,
      });
      await database.db.insert(sourceContributors).values({
        sourceId,
        ordinal: 0,
        nameAsPrinted: 'Curator A',
        role: 'author',
        attribution: 'as_printed',
      });
      await database.db.insert(sourceVersions).values({
        id: sourceVersionId,
        sourceId,
        ownerId,
        sourceHash: sha256,
        metadataSnapshot: metadata,
        capturedAt: now,
        status: 'ready',
        textIndexStatus: 'ready',
        imageIndexStatus: 'ready',
        activeParseRunId: parseRunId,
      });
      await database.db.insert(mediaAssets).values({
        id: assetId,
        ownerId,
        sourceVersionId,
        kind: 'photo',
        purpose: 'source_original',
        state: 'ready',
        objectKey: `originals/${assetId}`,
        originalFileName: 'page.png',
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(sourceVersionAssets).values({
        versionId: sourceVersionId,
        assetId,
        ordinal: 0,
        printedLabel: '1',
      });
      await database.db.insert(mediaDerivatives).values({
        id: derivativeId,
        ownerId,
        originalAssetId: assetId,
        kind: 'canonical',
        objectKey: key,
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(canonicalViews).values({
        id: viewId,
        originalAssetId: assetId,
        derivativeId,
        width: 100,
        height: 100,
        coordinateSpace: 'image_pixels',
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
      await database.db.insert(sourcePages).values({
        id: pageId,
        sourceVersionId,
        pageIndex: 0,
        printedPageLabel: '1',
        originalAssetId: assetId,
        canonicalViewId: viewId,
      });
      await database.db.insert(jobs).values({
        id: parseRunId,
        ownerId,
        kind: 'sourceIngestion',
        resourceId: sourceVersionId,
        state: 'succeeded',
        stage: 'parse',
      });
      await database.db.insert(parseRuns).values({
        id: parseRunId,
        sourceVersionId,
        jobId: parseRunId,
        provider: 'application',
        status: 'completed',
      });
      await database.db.insert(sourcePageParses).values({
        parseRunId,
        pageId,
        rawText: 'Original catalogue text',
        searchText: 'original catalogue text',
        quality: 'usable',
      });
      await database.db.insert(sourceRegions).values({
        id: regionId,
        sourceVersionId,
        pageId,
        parseRunId,
        kind: 'text',
        geometry: region,
        rawText: 'Original catalogue text',
      });
      await database.db.insert(sourceLocators).values({
        id: locatorId,
        sourceId,
        sourceVersionId,
        kind: 'page',
        pageId,
        pageIndex: 0,
        printedPageLabel: '1',
        canonicalViewId: viewId,
        regionId,
        geometry: region,
      });
      await database.db.insert(citations).values({
        id: citationId,
        locatorId,
        relation: 'background',
        availability: 'stored',
        verification: 'located',
      });
      await database.db.insert(referenceImages).values({
        id: imageId,
        sourceVersionId,
        locatorId,
        storedDerivativeId: derivativeId,
        captionAssociation: 'none',
      });
      await database.db.insert(knowledgeEntries).values({
        id: entryId,
        ownerId,
        displayCode: `K-${entryId}`,
        currentRevision: 1,
      });
      await database.db.insert(knowledgeRevisions).values({
        entryId,
        revision: 1,
        status: 'saved',
        titleZhHant: content.titleZhHant,
        summaryZhHant: content.summary.textZhHant,
        content,
        contentHash: sha256,
      });
      await database.db
        .insert(sourceKnowledgeDrafts)
        .values({ ownerId, sourceVersionId, entryId });
      await storage.writeDerivative({ key, bytes, mimeType: 'image/png' });
      const readers = createRetrievalReaders({
        db: database.db,
        transaction: createTransactionPort(database.db),
        storage,
        ownerId,
      });
      const foreign = createRetrievalReaders({
        db: database.db,
        transaction: createTransactionPort(database.db),
        storage,
        ownerId: randomUUID(),
      });

      expect(await readers.readImageEntries()).toEqual([
        {
          image: {
            originalAssetId: assetId,
            canonicalViewId: viewId,
            bytes,
            region,
          },
          match: {
            ref: {
              kind: 'reference',
              sourceVersionId,
              referenceImageId: imageId,
            },
            matchingRegions: [
              { canonicalViewId: viewId, region, derivativeId },
            ],
            thumbnail: null,
            sourceLocator: pageCitation.locator,
            sourceTitle: metadata.title,
            contributorNames: ['Curator A'],
            warningsZhHant: [],
          },
          filterIds: {
            objectTypeIds: [],
            materialIds: [],
            periodIds: [],
            regionIds: [],
            sourceIds: [sourceId],
          },
        },
      ]);
      const textEntries = await readers.readTextEntries();
      expect(textEntries).toHaveLength(2);
      expect(textEntries).toEqual(
        expect.arrayContaining([
          {
            summary: {
              id: entryId,
              displayCode: `K-${entryId}`,
              revision: 1,
              titleZhHant: content.titleZhHant,
              kinds: ['surface'],
              status: 'saved',
              summaryZhHant: content.summary.textZhHant,
              citationCount: 2,
            },
            citation: pageCitation,
            contentAsRetrieved: 'Original catalogue text',
            sourceRegionId: regionId,
          },
          {
            summary: {
              id: entryId,
              displayCode: `K-${entryId}`,
              revision: 1,
              titleZhHant: content.titleZhHant,
              kinds: ['surface'],
              status: 'saved',
              summaryZhHant: content.summary.textZhHant,
              citationCount: 2,
            },
            citation: webCitation,
            contentAsRetrieved: 'Online catalogue note',
            sourceRegionId: null,
          },
        ]),
      );
      expect(await foreign.readImageEntries()).toEqual([]);
      expect(await foreign.readTextEntries()).toEqual([]);
      const excluded = [null, '', '   '].map((rawText) => ({
        id: randomUUID(),
        rawText,
      }));
      for (const excludedRegion of excluded) {
        const excludedLocator = randomUUID();
        await database.db.insert(sourceRegions).values({
          ...excludedRegion,
          sourceVersionId,
          pageId,
          parseRunId,
          kind: 'text',
          geometry: region,
        });
        await database.db.insert(sourceLocators).values({
          id: excludedLocator,
          sourceId,
          sourceVersionId,
          kind: 'page',
          pageId,
          pageIndex: 0,
          canonicalViewId: viewId,
          regionId: excludedRegion.id,
          geometry: region,
        });
        await database.db.insert(citations).values({
          id: randomUUID(),
          locatorId: excludedLocator,
          relation: 'background',
          availability: 'stored',
          verification: 'located',
        });
      }
      expect(await readers.readTextEntries()).toEqual(textEntries);
      const additionalEntries = Array.from({ length: 200 }, () => randomUUID());
      await database.db.insert(knowledgeEntries).values(
        additionalEntries.map((id) => ({
          id,
          ownerId,
          displayCode: `K-${id}`,
          currentRevision: 1,
        })),
      );
      await database.db.insert(knowledgeRevisions).values(
        additionalEntries.map((id) => ({
          entryId: id,
          revision: 1,
          status: 'saved',
          titleZhHant: content.titleZhHant,
          summaryZhHant: content.summary.textZhHant,
          content,
          contentHash: sha256,
        })),
      );
      await database.db.insert(sourceKnowledgeDrafts).values(
        additionalEntries.map((id) => ({
          ownerId,
          sourceVersionId,
          entryId: id,
        })),
      );
      const additionalImages = Array.from({ length: 200 }, () => randomUUID());
      await database.db.insert(referenceImages).values(
        additionalImages.map((id) => ({
          id,
          sourceVersionId,
          locatorId,
          storedDerivativeId: derivativeId,
          captionAssociation: 'none',
        })),
      );
      const allText = await readers.readTextEntries();
      expect(
        allText
          .filter((item) => item.sourceRegionId === regionId)
          .map((item) => item.summary.id),
      ).toEqual([entryId, ...additionalEntries].sort());
      expect(
        allText
          .filter((item) => item.sourceRegionId === null)
          .map((item) => item.summary.id),
      ).toEqual([entryId, ...additionalEntries].sort());
      expect(allText).toHaveLength(402);
      const missingVersionCitation: SourceCitation = {
        ...webCitation,
        id: randomUUID(),
        locator: { ...webCitation.locator, sourceVersionId: randomUUID() },
      };
      const mismatchedSourceCitation: SourceCitation = {
        ...webCitation,
        id: randomUUID(),
        locator: { ...webCitation.locator, sourceId: randomUUID() },
      };
      const emptyExcerptCitation: SourceCitation = {
        ...webCitation,
        id: randomUUID(),
        locator: { ...webCitation.locator, excerptAsRetrieved: '' },
      };
      await database.db
        .update(knowledgeRevisions)
        .set({
          content: {
            ...content,
            citations: [
              ...content.citations,
              missingVersionCitation,
              mismatchedSourceCitation,
              emptyExcerptCitation,
            ],
          },
        })
        .where(eq(knowledgeRevisions.entryId, entryId));
      expect(
        (await readers.readTextEntries()).map((item) => item.citation.id),
      ).toEqual(allText.map((item) => item.citation.id));

      const allImages = await readers.readImageEntries();
      expect(
        allImages.map((item) =>
          item.match.ref.kind === 'reference'
            ? item.match.ref.referenceImageId
            : null,
        ),
      ).toEqual([imageId, ...additionalImages].sort());
      const blockId = randomUUID();
      await database.db.insert(sourceBlocks).values({
        id: blockId,
        parseRunId,
        pageId,
        rawText: 'Catalogue text',
        searchMapping: [],
        ordinal: 0,
      });
      await database.db
        .update(sourceLocators)
        .set({
          regionId: null,
          geometry: null,
          blockId,
          rangeStart: 0,
          rangeEnd: 5,
        })
        .where(eq(sourceLocators.id, locatorId));
      expect(
        (await readers.readImageEntries())[0]?.match.sourceLocator,
      ).toMatchObject({ region: null, textRange: { start: 0, end: 5 } });
      const webSourceId = randomUUID();
      const webVersionId = randomUUID();
      const webAssetId = randomUUID();
      const webDerivativeId = randomUUID();
      const webViewId = randomUUID();
      const webLocatorId = randomUUID();
      const webImageId = randomUUID();
      const webKey = `derivatives/${webAssetId}/${webDerivativeId}`;
      await database.db.insert(sources).values({
        id: webSourceId,
        ownerId,
        kind: 'web',
        currentVersionId: webVersionId,
        title: 'Museum website',
        authorStatus: 'unknown',
        access: 'stored_copy',
      });
      await database.db.insert(sourceVersions).values({
        id: webVersionId,
        sourceId: webSourceId,
        ownerId,
        sourceHash: createHash('sha256').update(webKey).digest('hex'),
        metadataSnapshot: { ...metadata, title: 'Museum website' },
        capturedAt: now,
        status: 'ready',
        textIndexStatus: 'ready',
        imageIndexStatus: 'ready',
      });
      await database.db.insert(mediaAssets).values({
        id: webAssetId,
        ownerId,
        sourceVersionId: webVersionId,
        kind: 'photo',
        purpose: 'source_original',
        state: 'ready',
        objectKey: `originals/${webAssetId}`,
        originalFileName: 'website.png',
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(mediaDerivatives).values({
        id: webDerivativeId,
        ownerId,
        originalAssetId: webAssetId,
        kind: 'canonical',
        objectKey: webKey,
        mimeType: 'image/png',
        byteLength: bytes.byteLength,
        sha256,
      });
      await database.db.insert(canonicalViews).values({
        id: webViewId,
        originalAssetId: webAssetId,
        derivativeId: webDerivativeId,
        width: 100,
        height: 100,
        coordinateSpace: 'image_pixels',
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      });
      await database.db.insert(sourceLocators).values({
        id: webLocatorId,
        sourceId: webSourceId,
        sourceVersionId: webVersionId,
        kind: 'web',
        url: 'https://museum.example/catalogue',
        retrievedAt: now,
        snapshotAssetId: webAssetId,
      });
      await database.db.insert(referenceImages).values({
        id: webImageId,
        sourceVersionId: webVersionId,
        locatorId: webLocatorId,
        storedDerivativeId: webDerivativeId,
        captionAssociation: 'none',
      });
      await storage.writeDerivative({
        key: webKey,
        bytes,
        mimeType: 'image/png',
      });
      const screenshot = (await readers.readImageEntries()).find(
        (item) => item.image.originalAssetId === webAssetId,
      );
      expect(screenshot).toMatchObject({
        image: {
          originalAssetId: webAssetId,
          canonicalViewId: webViewId,
          bytes,
          region: null,
        },
        match: {
          sourceLocator: null,
          sourceTitle: 'Museum website',
          contributorNames: [],
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
