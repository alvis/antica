import { QdrantClient } from '@qdrant/js-client-rest';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createQdrantImageRetrieval,
  createQdrantImageWriter,
} from './qdrant.js';

import type { ImageSearchRequest } from '@antica/contracts';

import type { ImageSearchEntry } from './image.js';
import type { QdrantImageRetrievalParams } from './qdrant.js';

const index = {
  embeddingModelId: 'voyage-multimodal-3.5',
  dimensions: 1024,
  indexVersion: 'catalog-v1',
};
const vector = Array<number>(1024).fill(0.25);
const query: ImageSearchRequest = {
  mode: 'search',
  queryAnchorId: 'query-anchor',
  includeWholeImage: false,
  scope: 'my_collection',
  filters: {},
  limit: 10,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Qdrant image retrieval boundary', () => {
  it('should resolve a reference-library match through the default SDK transport', async () => {
    vi.spyOn(QdrantClient.prototype, 'getCollection').mockResolvedValue(
      collection(),
    );
    vi.spyOn(QdrantClient.prototype, 'query').mockResolvedValue({
      points: [{ id: 'reference-point', version: 1, score: 1 }],
    });
    const canonical = entry('reference');
    const reference = {
      ...canonical,
      match: {
        ...canonical.match,
        ref: {
          kind: 'reference' as const,
          sourceVersionId: 'source-version',
          referenceImageId: 'reference-image',
        },
      },
    };
    const result = await createQdrantImageRetrieval(
      params({
        queryPoints: undefined,
        readCollection: undefined,
        resolveEntry: async () => reference,
      }),
    ).search({ ...query, scope: 'reference_library' }, index);
    expect(result).toMatchObject({
      success: true,
      data: {
        items: [
          {
            ref: {
              kind: 'reference',
              sourceVersionId: 'source-version',
              referenceImageId: 'reference-image',
            },
          },
        ],
      },
    });
  });

  it('should merge matching regions for the same authorized image and include unknown catalog fields by default', async () => {
    const result = await createQdrantImageRetrieval(
      params({
        queryPoints: async () => ({
          points: [
            { id: 'view-one', version: 1, score: 1 },
            { id: 'view-two', version: 1, score: 0.5 },
          ],
        }),
        resolveEntry: async (id) => {
          const canonical = entry('shared');

          return {
            ...canonical,
            match: {
              ...canonical.match,
              matchingRegions: [
                { canonicalViewId: id, region: null, derivativeId: null },
              ],
            },
          };
        },
      }),
    ).search({ ...query, filters: { materialIds: ['celadon'] } }, index);
    expect(result).toMatchObject({
      success: true,
      data: {
        items: [
          {
            ref: { originalAssetId: 'shared-original' },
            matchingRegions: [
              { canonicalViewId: 'view-one' },
              { canonicalViewId: 'view-two' },
            ],
          },
        ],
      },
    });
    if (!result.success) {
      throw new Error('Expected canonical matches');
    }
    expect(result.data.items).toHaveLength(1);
  });

  it('should allow an explicitly selected comparison in the configured index space', async () => {
    const comparison = {
      comparisonId: 'comparison',
      queryAnchorId: 'query-anchor',
      selected: {
        kind: 'collection' as const,
        recordId: 'record',
        originalAssetId: 'asset',
      },
      selectedRegion: null,
      selectedCanonicalViewId: null,
      similaritiesZhHant: ['表面相近'],
      differencesZhHant: [],
      limitsZhHant: ['不是年代鑑定'],
      citations: [],
    };
    const result = await createQdrantImageRetrieval(
      params({
        compare: async () => ({
          success: true,
          data: { value: comparison, invocation: null },
        }),
      }),
    ).compare(
      {
        mode: 'compare',
        queryAnchorId: 'query-anchor',
        selected: comparison.selected,
        selectedRegion: null,
        selectedCanonicalViewId: null,
      },
      index,
    );
    expect(result).toEqual({
      success: true,
      data: { value: comparison, invocation: null },
    });
  });

  it('should reject malformed cursors before requesting an embedding', async () => {
    const embed = vi.fn<QdrantImageRetrievalParams['embedding']['embed']>();
    const result = await createQdrantImageRetrieval(
      params({ embedding: { index, embed } }),
    ).search({ ...query, cursor: 'not-json' }, index);
    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should combine selected-region and whole-image queries without duplicate matches', async () => {
    const embed = vi
      .fn<QdrantImageRetrievalParams['embedding']['embed']>()
      .mockResolvedValue({ success: true, data: vector });
    const selectedRegion = {
      kind: 'rect' as const,
      x: 0,
      y: 0,
      width: 0.5,
      height: 0.5,
    };
    const result = await createQdrantImageRetrieval(
      params({
        embedding: { index, embed },
        readQuery: async () => ({
          originalAssetId: 'query-original',
          canonicalViewId: 'query-view',
          bytes: new Uint8Array([1]),
          region: selectedRegion,
        }),
        queryPoints: async () => ({
          points: [{ id: 'same', version: 1, score: 1 }],
        }),
        resolveEntry: async () => entry('same'),
      }),
    ).search({ ...query, includeWholeImage: true, limit: undefined }, index);
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({ region: selectedRegion }),
      'query',
    );
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({ region: null }),
      'query',
    );
    expect(result).toMatchObject({
      success: true,
      data: { items: [{ ref: { originalAssetId: 'same-original' } }] },
    });
    if (!result.success) {
      throw new Error('Expected retrieval');
    }
    expect(result.data.items).toHaveLength(1);
  });

  it('should send tenant and corpus filters and return only authorized canonical metadata', async () => {
    const queryPoints = vi
      .fn<NonNullable<QdrantImageRetrievalParams['queryPoints']>>()
      .mockResolvedValue({
        points: [
          {
            id: 'allowed',
            version: 1,
            score: 0.9,
            payload: {
              sourceTitle: 'Untrusted provider title',
              ownerId: 'other-owner',
            },
          },
          { id: 'forbidden', version: 1, score: 1 },
        ],
      });
    const canonical = entry('allowed');
    const resolveEntry = vi
      .fn<QdrantImageRetrievalParams['resolveEntry']>()
      .mockImplementation(async (id) => (id === 'allowed' ? canonical : null));
    const result = await createQdrantImageRetrieval(
      params({ queryPoints, resolveEntry }),
    ).search(query, index);
    expect(queryPoints).toHaveBeenCalledWith(
      'images',
      expect.objectContaining({
        filter: {
          must: expect.arrayContaining([
            { key: 'ownerId', match: { value: 'collector' } },
            { key: 'corpusId', match: { value: 'private-library' } },
            { key: 'indexVersion', match: { value: index.indexVersion } },
            {
              key: 'embeddingModelId',
              match: { value: index.embeddingModelId },
            },
            { key: 'dimensions', match: { value: index.dimensions } },
            { key: 'scope', match: { value: 'my_collection' } },
          ]),
          must_not: [
            { key: 'originalAssetId', match: { value: 'query-original' } },
          ],
        },
        with_payload: false,
        with_vector: false,
      }),
    );
    expect(resolveEntry).toHaveBeenCalledWith('forbidden');
    expect(result).toMatchObject({
      success: true,
      data: {
        availableScope: 'partial',
        items: [{ ...canonical.match, rank: 1 }],
      },
    });
    if (!result.success) {
      throw new Error('Expected successful canonical retrieval');
    }
    expect(result.data.items).toHaveLength(1);
  });

  it.each([
    'model',
    'dimensions',
    'version',
    'owner',
    'corpus',
    'embedding',
  ] as const)(
    'should reject incompatible %s before any provider access',
    async (kind) => {
      const readCollection =
        vi.fn<NonNullable<QdrantImageRetrievalParams['readCollection']>>();
      const queryPoints =
        vi.fn<NonNullable<QdrantImageRetrievalParams['queryPoints']>>();
      const overrides: Partial<QdrantImageRetrievalParams> =
        kind === 'owner'
          ? { ownerId: '' }
          : kind === 'corpus'
            ? { corpusId: '' }
            : kind === 'embedding'
              ? {
                  embedding: {
                    index: { ...index, dimensions: 2 },
                    embed: async () => ({ success: true, data: [1, 2] }),
                  },
                }
              : {};
      const requested = {
        ...index,
        embeddingModelId:
          kind === 'model' ? 'other-model' : index.embeddingModelId,
        dimensions: kind === 'dimensions' ? 2 : index.dimensions,
        indexVersion: kind === 'version' ? 'old' : index.indexVersion,
      };
      const result = await createQdrantImageRetrieval(
        params({ ...overrides, readCollection, queryPoints }),
      ).search(query, requested);
      expect(result).toMatchObject({
        success: false,
        error: { code: 'INDEX_NOT_READY' },
      });
      expect(readCollection).not.toHaveBeenCalled();
      expect(queryPoints).not.toHaveBeenCalled();
    },
  );

  it.each([
    { size: 512, distance: 'Cosine' },
    { size: 1024, distance: 'Dot' },
  ])(
    'should reject a physical collection with incompatible vectors $size/$distance',
    async (vectors) => {
      const queryPoints =
        vi.fn<NonNullable<QdrantImageRetrievalParams['queryPoints']>>();
      const result = await createQdrantImageRetrieval(
        params({
          readCollection: async () => collection(vectors),
          queryPoints,
        }),
      ).search(query, index);
      expect(result).toMatchObject({
        success: false,
        error: { code: 'INDEX_NOT_READY' },
      });
      expect(queryPoints).not.toHaveBeenCalled();
    },
  );

  it('should bind pagination to its query and filter resolved canonical entries', async () => {
    const queryPoints = vi
      .fn<NonNullable<QdrantImageRetrievalParams['queryPoints']>>()
      .mockResolvedValue({
        points: [
          { id: 'one', version: 1, score: 0.9 },
          { id: 'two', version: 1, score: 0.8 },
          { id: 'unknown-material', version: 1, score: 0.7 },
        ],
      });
    const service = createQdrantImageRetrieval(
      params({
        queryPoints,
        resolveEntry: async (id) =>
          entry(id, id === 'unknown-material' ? [] : ['celadon']),
      }),
    );
    const request = {
      ...query,
      limit: 1,
      filters: { materialIds: ['celadon'], includeUnknown: false },
    };
    const first = await service.search(request, index);
    if (!first.success || !first.data.nextCursor) {
      throw new Error('Expected first page and cursor');
    }
    expect(first.data.items[0]?.ref).toMatchObject({
      originalAssetId: 'one-original',
    });
    const second = await service.search(
      { ...request, cursor: first.data.nextCursor },
      index,
    );
    expect(second).toMatchObject({
      success: true,
      data: {
        items: [{ ref: { originalAssetId: 'two-original' } }],
        nextCursor: null,
      },
    });
    const before = queryPoints.mock.calls.length;
    expect(
      await service.search(
        { ...request, filters: {}, cursor: first.data.nextCursor },
        index,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(queryPoints).toHaveBeenCalledTimes(before);
  });

  it('should stop before vector retrieval when query embedding fails', async () => {
    const queryPoints =
      vi.fn<NonNullable<QdrantImageRetrievalParams['queryPoints']>>();
    const result = await createQdrantImageRetrieval(
      params({
        queryPoints,
        embedding: {
          index,
          embed: async () => ({
            success: false,
            error: {
              code: 'PROVIDER_UNAVAILABLE',
              message: 'Embedding unavailable',
              retryable: true,
            },
          }),
        },
      }),
    ).search(query, index);
    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(queryPoints).not.toHaveBeenCalled();
  });

  it('should return a typed failure when Qdrant cannot read the collection', async () => {
    const result = await createQdrantImageRetrieval(
      params({
        readCollection: async () => {
          throw new Error('Network unavailable');
        },
      }),
    ).search(query, index);
    expect(result).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
    });
  });

  it('should reject an incompatible comparison before resolving selected images', async () => {
    const compare = vi.fn<QdrantImageRetrievalParams['compare']>();
    const result = await createQdrantImageRetrieval(
      params({ compare }),
    ).compare(
      {
        mode: 'compare',
        queryAnchorId: 'query-anchor',
        selected: {
          kind: 'collection',
          recordId: 'record',
          originalAssetId: 'asset',
        },
        selectedRegion: null,
        selectedCanonicalViewId: null,
      },
      { ...index, indexVersion: 'old' },
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY' },
    });
    expect(compare).not.toHaveBeenCalled();
  });
});

describe('Qdrant document ingestion boundary', () => {
  it('should refuse an unscoped write before embedding or storage access', async () => {
    const embed = vi.fn<QdrantImageRetrievalParams['embedding']['embed']>();
    expect(
      await createQdrantImageWriter(
        params({ ownerId: '', embedding: { index, embed } }),
      ).upsert({ pointId: 'point', entry: entry('source') }),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should preserve an embedding failure without sending an upsert', async () => {
    const upsert = vi
      .spyOn(QdrantClient.prototype, 'upsert')
      .mockResolvedValue({ status: 'completed' });
    expect(
      await createQdrantImageWriter(
        params({
          embedding: {
            index,
            embed: async () => ({
              success: false,
              error: {
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Unavailable',
                retryable: true,
              },
            }),
          },
        }),
      ).upsert({ pointId: 'point', entry: entry('source') }),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('should refuse writing a vector into a physically incompatible collection', async () => {
    vi.spyOn(QdrantClient.prototype, 'getCollection').mockResolvedValue(
      collection({ size: 512, distance: 'Cosine' }),
    );
    const upsert = vi
      .spyOn(QdrantClient.prototype, 'upsert')
      .mockResolvedValue({ status: 'completed' });
    expect(
      await createQdrantImageWriter(params()).upsert({
        pointId: 'point',
        entry: entry('source'),
      }),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('should report a failed write instead of acknowledging persistence', async () => {
    vi.spyOn(QdrantClient.prototype, 'getCollection').mockResolvedValue(
      collection(),
    );
    vi.spyOn(QdrantClient.prototype, 'upsert').mockRejectedValue(
      new Error('Write unavailable'),
    );
    expect(
      await createQdrantImageWriter(params()).upsert({
        pointId: 'point',
        entry: entry('source'),
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
    });
  });

  it.each([
    { kind: 'collection', scope: 'my_collection' },
    { kind: 'reference', scope: 'reference_library' },
  ])(
    'should persist $kind vectors with collector, corpus, index identity, and original asset',
    async ({ kind, scope }) => {
      vi.spyOn(QdrantClient.prototype, 'getCollection').mockResolvedValue(
        collection(),
      );
      const upsert = vi
        .spyOn(QdrantClient.prototype, 'upsert')
        .mockResolvedValue({ status: 'completed' });
      const embed = vi
        .fn<QdrantImageRetrievalParams['embedding']['embed']>()
        .mockResolvedValue({ success: true, data: vector });
      const canonical = entry('source');
      const document = {
        pointId: 'document-point',
        entry:
          kind === 'reference'
            ? {
                ...canonical,
                match: {
                  ...canonical.match,
                  ref: {
                    kind: 'reference' as const,
                    sourceVersionId: 'version',
                    referenceImageId: 'reference-image',
                  },
                },
              }
            : canonical,
      };
      expect(
        await createQdrantImageWriter(
          params({ embedding: { index, embed } }),
        ).upsert(document),
      ).toEqual({ success: true, data: null });
      expect(embed).toHaveBeenCalledWith(document.entry.image, 'document');
      expect(upsert).toHaveBeenCalledWith('images', {
        wait: true,
        points: [
          {
            id: document.pointId,
            vector,
            payload: {
              ownerId: 'collector',
              corpusId: 'private-library',
              ...index,
              scope,
              originalAssetId: 'source-original',
            },
          },
        ],
      });
    },
  );
});

function params(
  overrides: Partial<QdrantImageRetrievalParams> = {},
): QdrantImageRetrievalParams {
  return {
    url: 'http://127.0.0.1:6333',
    collection: 'images',
    ownerId: 'collector',
    corpusId: 'private-library',
    index,
    embedding: { index, embed: async () => ({ success: true, data: vector }) },
    readQuery: async () => ({
      originalAssetId: 'query-original',
      canonicalViewId: 'query-view',
      bytes: new Uint8Array([1]),
      region: null,
    }),
    resolveEntry: async () => null,
    compare: async () => {
      throw new Error('Comparison not used in this scenario');
    },
    queryPoints: async () => ({ points: [] }),
    readCollection: async () => collection(),
    ...overrides,
  };
}

function collection(
  vectors: { size: number; distance: string } = {
    size: 1024,
    distance: 'Cosine',
  },
): Awaited<ReturnType<QdrantClient['getCollection']>> {
  return { config: { params: { vectors } } } as Awaited<
    ReturnType<QdrantClient['getCollection']>
  >;
}

function entry(
  id: string,
  materialIds: readonly string[] = [],
): ImageSearchEntry {
  return {
    image: {
      originalAssetId: `${id}-original`,
      canonicalViewId: `${id}-view`,
      bytes: new Uint8Array([1]),
      region: null,
    },
    match: {
      ref: {
        kind: 'collection',
        recordId: `${id}-record`,
        originalAssetId: `${id}-original`,
      },
      matchingRegions: [],
      thumbnail: null,
      sourceLocator: null,
      sourceTitle: 'Canonical collector title',
      contributorNames: [],
      warningsZhHant: [],
    },
    filterIds: {
      objectTypeIds: [],
      materialIds,
      periodIds: [],
      regionIds: [],
      sourceIds: [],
    },
  };
}
