import { createHash, randomUUID } from 'node:crypto';

import { inject, describe, expect, vi } from 'vitest';

import {
  createMediaService,
  createRecordService,
} from '@antica/application/server';
import {
  analysisAcceptedSchema,
  analysisRunDetailSchema,
  evidenceAnchorSchema,
  sourceAcceptedSchema,
  sourceDetailSchema,
  mediaDetailSchema,
  recordDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { collectorUserId } from '@antica/platform';
import { createConfiguredModels } from '@antica/platform/ai';

import { createHttpTest } from './fixtures/http/test.js';
import { createLocalSettings } from './fixtures/runtime.js';
import { createImageProviders } from './retrieval.js';

import type { ModelConfiguration } from '@antica/platform/ai';

import type { HttpFixture } from './fixtures/http.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['cloud-jobs']!, {
  ...createLocalSettings(),
  image: {
    ANTICA_IMAGE_SEARCH_DRIVER: 'voyage-qdrant',
    VOYAGE_API_KEY: 'synthetic-test-key',
    QDRANT_URL: 'http://qdrant.test',
    QDRANT_COLLECTION: 'images',
    IMAGE_EMBEDDING_MODEL_ID: 'voyage-multimodal-3.5',
    IMAGE_EMBEDDING_DIMENSIONS: 1024,
    IMAGE_INDEX_VERSION: 'image-test-v1',
    IMAGE_CORPUS_ID: 'private-corpus',
  },
}).extend('transportState', async ({ task: _task }) => {
  const respondToUpsert = vi.fn(async (): Promise<Response> =>
    Response.json({
      result: { status: 'completed' },
      status: 'ok',
      time: 0,
    }),
  );
  const upserts: unknown[] = [];
  const requested: string[] = [];
  const queryPoints: Array<{ id: string; version: number; score: number }> = [];
  const transport = vi.fn<typeof fetch>(async (...args) => {
    const request = new Request(args[0], args[1]);
    const url = new URL(request.url);
    requested.push(request.url);
    if (url.hostname === 'api.voyageai.com') {
      return Response.json({
        data: [{ index: 0, embedding: Array<number>(1024).fill(0.25) }],
      });
    }
    if (
      url.hostname === 'qdrant.test' &&
      url.pathname.endsWith('/points') &&
      request.method === 'PUT'
    ) {
      upserts.push(await request.json());

      return respondToUpsert();
    }
    if (
      url.hostname === 'qdrant.test' &&
      url.pathname.endsWith('/points/query')
    ) {
      return Response.json({
        result: { points: queryPoints },
        status: 'ok',
        time: 0,
      });
    }
    if (url.hostname === 'qdrant.test' && request.method === 'GET') {
      return Response.json({
        result: {
          config: { params: { vectors: { size: 1024, distance: 'Cosine' } } },
        },
        status: 'ok',
        time: 0,
      });
    }
    throw new Error(
      `Unexpected test transport ${request.method} ${url.origin}${url.pathname}`,
    );
  });
  vi.stubGlobal('fetch', transport);

  return { respondToUpsert, upserts, requested, queryPoints };
});

describe('Configured cloud image indexing', () => {
  it.for([false, true])(
    'should index canonical collector pixels before completing the durable media job, transient failure: %s',
    async (
      failOnce,
      {
        fixture,
        transportState: { respondToUpsert, upserts, requested, queryPoints },
      },
    ) => {
      const record = recordDetailSchema.parse(
        await (
          await fixture.request(
            '/v1/records',
            'POST',
            { unitKind: 'single' },
            randomUUID(),
          )
        ).json(),
      );
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
        'base64',
      );
      const started = await fixture.request('/v1/media/uploads', 'POST', {
        requestKey: randomUUID(),
        target: { kind: 'record', recordId: record.id },
        kind: 'photo',
        purpose: 'object',
        componentIds: [],
        fileName: 'capture.png',
        mimeType: 'image/png',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      expect(started.status).toBe(201);
      const upload = uploadSessionSchema.parse(await started.json());
      if (upload.mode !== 'single') {
        throw new Error('Expected local single upload');
      }
      const uploaded = await fixture.runtime.app.request(upload.putUrl, {
        method: 'PUT',
        headers: upload.headers,
        body: bytes,
      });
      expect(uploaded.status).toBe(204);
      const completed = await fixture.request(
        `/v1/media/${upload.assetId}/complete`,
        'POST',
        { requestKey: randomUUID() },
      );
      expect(completed.status).toBe(200);
      expect(await completed.json()).toMatchObject({
        assetId: upload.assetId,
        state: 'uploaded',
        processingJobId: expect.any(String),
      });
      if (failOnce) {
        respondToUpsert.mockResolvedValueOnce(
          Response.json({ error: 'Unavailable' }, { status: 503 }),
        );
        expect(await fixture.runtime.drain()).toMatchObject({
          settled: 0,
          failures: [expect.objectContaining({ code: 'SOURCE_UNAVAILABLE' })],
        });
        const pending = mediaDetailSchema.parse(
          await (await fixture.request(`/v1/media/${upload.assetId}`)).json(),
        );
        expect(pending.asset.state).not.toBe('ready');
        upserts.length = 0;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.advanceTimersByTime(60_000);
      }
      const drained = await fixture.runtime.drain();
      expect(requested.length).toBeGreaterThan(0);
      expect(drained).toMatchObject({
        settled: 1,
        failures: [],
      });
      const response = await fixture.request(`/v1/media/${upload.assetId}`);
      expect(response.status).toBe(200);
      const media = mediaDetailSchema.parse(await response.json());
      expect(upserts).toEqual([
        {
          points: [
            {
              id: media.asset.views[0]?.id,
              vector: Array<number>(1024).fill(0.25),
              payload: {
                ownerId: collectorUserId,
                corpusId: 'private-corpus',
                embeddingModelId: 'voyage-multimodal-3.5',
                dimensions: 1024,
                indexVersion: 'image-test-v1',
                scope: 'my_collection',
                originalAssetId: upload.assetId,
              },
            },
          ],
        },
      ]);
      const anchor = evidenceAnchorSchema.parse(
        await (
          await fixture.request('/v1/evidence', 'POST', {
            mode: 'create',
            requestKey: randomUUID(),
            evidence: {
              kind: 'image',
              recordId: record.id,
              componentIds: [],
              originalAssetId: upload.assetId,
              canonicalViewId: media.asset.views[0]?.id,
              scope: { kind: 'whole' },
            },
          })
        ).json(),
      );
      queryPoints.push({ id: media.asset.views[0]!.id, version: 1, score: 1 });
      const query = {
        mode: 'search' as const,
        queryAnchorId: anchor.id,
        includeWholeImage: false,
        scope: 'my_collection' as const,
        filters: {},
        limit: 10,
      };
      expect(
        await fixture.runtime.images.search(query, fixture.runtime.imageIndex),
      ).toMatchObject({
        success: true,
        data: { availableScope: 'complete', items: [] },
      });
      queryPoints.push({ id: randomUUID(), version: 1, score: 0.5 });
      expect(
        await fixture.runtime.images.search(query, fixture.runtime.imageIndex),
      ).toMatchObject({
        success: true,
        data: { availableScope: 'partial', items: [] },
      });
      expect(media.asset).toMatchObject({
        state: 'ready',
        views: [expect.objectContaining({ originalAssetId: upload.assetId })],
      });
      expect(
        (await fixture.runtime.storage.read(`originals/${upload.assetId}`))
          .bytes,
      ).toEqual(bytes);
      expect(await fixture.runtime.drain()).toMatchObject({
        inspected: 0,
        settled: 0,
        failures: [],
      });
      const comparisonSettings = createComparisonSettings();
      const comparison = createImageProviders(
        {
          ...comparisonSettings,
          image: {
            ANTICA_IMAGE_SEARCH_DRIVER: 'voyage-qdrant',
            VOYAGE_API_KEY: 'synthetic-test-key',
            QDRANT_URL: 'http://qdrant.test',
            QDRANT_COLLECTION: 'images',
            IMAGE_EMBEDDING_MODEL_ID: 'voyage-multimodal-3.5',
            IMAGE_EMBEDDING_DIMENSIONS: 1024,
            IMAGE_INDEX_VERSION: 'image-test-v1',
            IMAGE_CORPUS_ID: 'private-corpus',
          },
        },
        fixture.runtime,
      );
      const selected = {
        kind: 'collection' as const,
        recordId: record.id,
        originalAssetId: upload.assetId,
      };
      for (const selectedCanonicalViewId of [null, media.asset.views[0]!.id]) {
        expect(
          await comparison.port.compare(
            {
              mode: 'compare',
              queryAnchorId: anchor.id,
              selected,
              selectedCanonicalViewId,
              selectedRegion: {
                kind: 'rect',
                x: -1,
                y: 0,
                width: 1,
                height: 1,
              },
            },
            comparison.index,
          ),
        ).toMatchObject({
          success: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      }
      expect(
        await comparison.port.compare(
          {
            mode: 'compare',
            queryAnchorId: anchor.id,
            selected,
            selectedCanonicalViewId: randomUUID(),
            selectedRegion: null,
          },
          comparison.index,
        ),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      expect(
        await comparison.port.compare(
          {
            mode: 'compare',
            queryAnchorId: anchor.id,
            selected: { ...selected, originalAssetId: randomUUID() },
            selectedCanonicalViewId: null,
            selectedRegion: null,
          },
          comparison.index,
        ),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      const currentRecord = recordDetailSchema.parse(
        await (await fixture.request(`/v1/records/${record.id}`)).json(),
      );
      const analysis = analysisAcceptedSchema.parse(
        await (
          await fixture.request(
            `/v1/records/${record.id}/analyses`,
            'POST',
            { expectedRecordRevision: currentRecord.recordRevision },
            randomUUID(),
          )
        ).json(),
      );
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const analyzed = analysisRunDetailSchema.parse(
        await (await fixture.request(`/v1/analyses/${analysis.runId}`)).json(),
      );
      expect(analyzed).toMatchObject({
        status: 'completed',
        snapshot: { evidenceIds: expect.arrayContaining([anchor.id]) },
      });
    },
  );

  it.for([false, true])(
    'should index the retained source reference, transient failure: %s',
    async (
      failOnce,
      {
        fixture,
        transportState: { respondToUpsert, upserts, requested, queryPoints },
      },
    ) => {
      const intakeKey = randomUUID();
      const bytes = Buffer.concat([
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
          'base64',
        ),
        Buffer.from(failOnce ? 'retry-fixture' : 'initial-fixture'),
      ]);
      const upload = uploadSessionSchema.parse(
        await (
          await fixture.request('/v1/media/uploads', 'POST', {
            requestKey: randomUUID(),
            target: { kind: 'source_intake', intakeKey },
            kind: 'photo',
            purpose: 'book_page',
            componentIds: [],
            fileName: 'page.png',
            mimeType: 'image/png',
            byteLength: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          })
        ).json(),
      );
      if (upload.mode !== 'single') {
        throw new Error('Expected local single upload');
      }
      expect(
        (
          await fixture.runtime.app.request(upload.putUrl, {
            method: 'PUT',
            headers: upload.headers,
            body: bytes,
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await fixture.request(
            `/v1/media/${upload.assetId}/complete`,
            'POST',
            {
              requestKey: randomUUID(),
            },
          )
        ).status,
      ).toBe(200);
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const registered = await fixture.request('/v1/sources', 'POST', {
        mode: 'register',
        requestKey: randomUUID(),
        registration: {
          intakeKey,
          kind: 'book_pages',
          existingSourceId: null,
          expectedRevision: null,
          assets: [
            { assetId: upload.assetId, order: 0, printedPageLabel: '十二' },
          ],
          metadata: {
            title: `器物研究 ${randomUUID()}`,
            contributors: [],
            authorStatus: 'unknown',
            editionStatement: null,
            publisher: null,
            publicationDateAsPrinted: null,
            isbn: null,
            languages: ['zh-Hant'],
            canonicalUrl: null,
            access: 'stored_copy',
            rightsStatement: null,
            attributionText: null,
          },
        },
      });
      expect(registered.status).toBe(202);
      const accepted = sourceAcceptedSchema.parse(await registered.json());
      if (failOnce) {
        respondToUpsert.mockResolvedValueOnce(
          Response.json({ error: 'Unavailable' }, { status: 503 }),
        );
        expect(await fixture.runtime.drain()).toMatchObject({
          settled: 0,
          failures: [expect.objectContaining({ code: 'SOURCE_UNAVAILABLE' })],
        });
        const pending = sourceDetailSchema.parse(
          await (
            await fixture.request(`/v1/sources/${accepted.sourceId}`)
          ).json(),
        );
        expect(pending.version.imageIndexStatus).not.toBe('ready');
        upserts.length = 0;
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.advanceTimersByTime(60_000);
      }

      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const detail = sourceDetailSchema.parse(
        await (
          await fixture.request(`/v1/sources/${accepted.sourceId}`)
        ).json(),
      );
      expect(detail.version).toMatchObject({
        id: accepted.sourceVersionId,
        status: 'partial',
      });
      expect(detail.pages.items).toMatchObject([
        {
          originalAssetId: upload.assetId,
          printedPageLabel: '十二',
          rawText: '',
          quality: 'needs_review',
        },
      ]);
      expect(detail.referenceImages).toHaveLength(1);
      expect(upserts).toEqual([
        {
          points: [
            {
              id: detail.referenceImages[0]?.id,
              vector: Array<number>(1024).fill(0.25),
              payload: {
                ownerId: collectorUserId,
                corpusId: 'private-corpus',
                embeddingModelId: 'voyage-multimodal-3.5',
                dimensions: 1024,
                indexVersion: 'image-test-v1',
                scope: 'reference_library',
                originalAssetId: upload.assetId,
              },
            },
          ],
        },
      ]);
      const queryImage = await uploadCollectionImage(fixture, collectorUserId);
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const queryMedia = mediaDetailSchema.parse(
        await (await fixture.request(`/v1/media/${queryImage.assetId}`)).json(),
      );
      const queryAnchor = evidenceAnchorSchema.parse(
        await (
          await fixture.request('/v1/evidence', 'POST', {
            mode: 'create',
            requestKey: randomUUID(),
            evidence: {
              kind: 'image',
              recordId: queryImage.recordId,
              componentIds: [],
              originalAssetId: queryImage.assetId,
              canonicalViewId: queryMedia.asset.views[0]!.id,
              scope: { kind: 'whole' },
            },
          })
        ).json(),
      );
      queryPoints.push({
        id: detail.referenceImages[0]!.id,
        version: 1,
        score: 1,
      });
      expect(
        await fixture.runtime.images.search(
          {
            mode: 'search',
            queryAnchorId: queryAnchor.id,
            includeWholeImage: false,
            scope: 'reference_library',
            filters: {},
            limit: 10,
          },
          fixture.runtime.imageIndex,
        ),
      ).toMatchObject({
        success: true,
        data: {
          availableScope: 'complete',
          items: [
            expect.objectContaining({
              ref: {
                kind: 'reference',
                sourceVersionId: accepted.sourceVersionId,
                referenceImageId: detail.referenceImages[0]!.id,
              },
            }),
          ],
        },
      });
      expect(
        (await fixture.runtime.storage.read(`originals/${upload.assetId}`))
          .bytes,
      ).toEqual(bytes);
      expect(await fixture.runtime.drain()).toMatchObject({
        inspected: 0,
        settled: 0,
      });
    },
  );
  it('should refuse a foreign-owner public-service outbox producer before cloud indexing', async ({
    fixture,
    transportState: { respondToUpsert, upserts, requested, queryPoints },
  }) => {
    const ownerId = randomUUID();
    const upload = await uploadCollectionImage(fixture, ownerId);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [expect.objectContaining({ code: 'FORBIDDEN' })],
    });
    expect(upserts).toEqual([]);
    expect(requested).toEqual([]);
    const foreign = await fixture.runtime.transaction.run(
      ownerId,
      async (unit) => ({
        success: true,
        data: await unit.media.get(upload.assetId),
      }),
    );
    expect(foreign.data?.state).not.toBe('ready');
    expect(
      (await fixture.request(`/v1/records/${upload.recordId}`)).status,
    ).toBe(404);
  });
});

/**
 * creates validated live profiles for comparison reader failures before provider execution
 * @returns model settings with explicit synthetic provider credentials
 */
function createComparisonSettings() {
  const capabilities = {
    textInput: true,
    imageInput: true,
    audioInput: true,
    structuredOutput: true,
    toolCalling: false,
    maxImages: 10,
  };
  const modelConfig = {
    driver: 'live',
    production: false,
    gatewayApiKey: 'synthetic-test-key',
    openAiApiKey: 'synthetic-test-key',
    profiles: [
      {
        modelId: 'gateway:comparison-fixture',
        provider: 'gateway',
        providerModelVersion: null,
        adapterKind: 'live',
        roles: ['analysis', 'research', 'recordEditing'],
        capabilities,
      },
      {
        modelId: 'openai:transcription-fixture',
        provider: 'openai',
        providerModelVersion: null,
        adapterKind: 'live',
        roles: ['transcription'],
        capabilities,
      },
    ],
    selections: {
      analysis: {
        modelId: 'gateway:comparison-fixture',
        role: 'analysis',
        profileVersion: 'fixture-v1',
      },
      research: {
        modelId: 'gateway:comparison-fixture',
        role: 'research',
        profileVersion: 'fixture-v1',
      },
      recordEditing: {
        modelId: 'gateway:comparison-fixture',
        role: 'recordEditing',
        profileVersion: 'fixture-v1',
      },
      transcription: {
        modelId: 'openai:transcription-fixture',
        role: 'transcription',
        profileVersion: 'fixture-v1',
      },
    },
  } satisfies ModelConfiguration;
  const models = createConfiguredModels(modelConfig);
  if (!models.success) {
    throw new Error('Invalid comparison test model config');
  }

  return { ...createLocalSettings(), modelConfig, models: models.data };
}

/**
 * creates real record media and an outbox message through owner-scoped application services
 * @param fixture file-owned application runtime
 * @param ownerId authenticated service consumer identity
 * @returns persisted original and record identifiers awaiting the composed drain
 */
async function uploadCollectionImage(
  fixture: HttpFixture,
  ownerId: string,
): Promise<{ assetId: string; recordId: string }> {
  const { transaction, clock, ids, storage } = fixture.runtime;
  const records = createRecordService(transaction, clock, ids);
  const media = createMediaService(transaction, storage, clock, ids);
  const record = await records.create(ownerId, randomUUID(), {
    unitKind: 'single',
  });
  if (!record.success) {
    throw new Error('Record producer failed');
  }
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
    'base64',
  );
  const upload = await media.start(ownerId, {
    requestKey: randomUUID(),
    target: { kind: 'record', recordId: record.data.id },
    kind: 'photo',
    purpose: 'object',
    componentIds: [],
    fileName: 'query.png',
    mimeType: 'image/png',
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  if (!upload.success || upload.data.mode !== 'single') {
    throw new Error('Media upload producer failed');
  }
  expect(
    (
      await fixture.runtime.app.request(upload.data.putUrl, {
        method: 'PUT',
        headers: upload.data.headers,
        body: bytes,
      })
    ).status,
  ).toBe(204);
  expect(
    await media.complete(ownerId, upload.data.assetId, randomUUID()),
  ).toMatchObject({ success: true });

  return { assetId: upload.data.assetId, recordId: record.data.id };
}
