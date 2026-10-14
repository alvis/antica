import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  createLocalImageRetrieval,
  developmentImageIndex,
  getImageMatchIdentity,
} from './image.js';

import type { ImageSearchEntry, SearchImage } from './image.js';

const query = {
  mode: 'search' as const,
  queryAnchorId: 'anchor',
  scope: 'my_collection' as const,
  includeWholeImage: false,
  filters: {},
};

async function fixture() {
  const bytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#285078' },
  })
    .png()
    .toBuffer();
  const image: SearchImage = {
    originalAssetId: 'query',
    canonicalViewId: 'query-view',
    bytes,
    region: null,
  };
  const first: ImageSearchEntry = {
    image: {
      ...image,
      originalAssetId: 'first',
      canonicalViewId: 'first-view',
    },
    match: {
      ref: { kind: 'collection', originalAssetId: 'first', recordId: 'record' },
      matchingRegions: [],
      thumbnail: null,
      sourceLocator: null,
      sourceTitle: null,
      contributorNames: [],
      warningsZhHant: [],
    },
    filterIds: {
      objectTypeIds: [],
      materialIds: [],
      periodIds: [],
      regionIds: [],
      sourceIds: [],
    },
  };
  const second: ImageSearchEntry = {
    ...first,
    image: { ...first.image, originalAssetId: 'second' },
    match: {
      ...first.match,
      ref: {
        kind: 'collection',
        originalAssetId: 'second',
        recordId: 'record',
      },
    },
  };

  return { image, first, second };
}

describe('fn:createLocalImageRetrieval', () => {
  it('should reject a selection outside its canonical pixels and malformed cursors', async () => {
    const { image, first } = await fixture();
    const invalid = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => ({
        ...image,
        region: { kind: 'rect', x: 0.9, y: 0, width: 0.5, height: 1 },
      }),
      readEntries: async () => [first],
    });
    expect(await invalid.search(query, developmentImageIndex)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => image,
      readEntries: async () => [first],
    });
    expect(
      await adapter.search(
        { ...query, cursor: 'not-json' },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
  });
  it('should return typed failures for incompatible descriptors and undecodable canonical images', async () => {
    const { image, first } = await fixture();
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => ({ ...image, bytes: Buffer.from('corrupt') }),
      readEntries: async () => [first],
    });
    const request = {
      mode: 'compare' as const,
      queryAnchorId: 'anchor',
      selected: first.match.ref,
      selectedCanonicalViewId: null,
      selectedRegion: null,
    };
    const foreign = { ...developmentImageIndex, indexVersion: 'foreign' };
    expect(await adapter.search(query, foreign)).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY' },
    });
    expect(await adapter.compare(request, foreign)).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY' },
      audit: { invocation: null, rawOutput: null },
    });
    expect(await adapter.search(query, developmentImageIndex)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    expect(await adapter.compare(request, developmentImageIndex)).toMatchObject(
      {
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
        audit: { invocation: null, rawOutput: null },
      },
    );
  });
  it('should honor reference scope and classification unknown policy while searching a polygon and whole image', async () => {
    const { image, first, second } = await fixture();
    const reference: ImageSearchEntry = {
      ...first,
      match: {
        ...first.match,
        ref: {
          kind: 'reference',
          sourceVersionId: 'source-v1',
          referenceImageId: 'reference',
        },
      },
      filterIds: { ...first.filterIds, materialIds: ['clay'] },
    };
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => ({
        ...image,
        region: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      }),
      readEntries: async () => [first, second, reference],
    });
    expect(
      await adapter.search(
        {
          ...query,
          scope: 'reference_library',
          includeWholeImage: true,
          filters: { materialIds: ['clay'], includeUnknown: false },
        },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: true,
      data: { items: [{ ...reference.match, rank: 1 }] },
    });
    expect(
      await adapter.search(
        { ...query, filters: { materialIds: ['clay'] } },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: true,
      data: {
        items: [
          { ...first.match, rank: 1 },
          { ...second.match, rank: 2 },
        ],
      },
    });
    expect(
      await adapter.search(
        { ...query, filters: { materialIds: ['clay'], includeUnknown: false } },
        developmentImageIndex,
      ),
    ).toMatchObject({ success: true, data: { items: [] } });
  });
  it('should compare selected canonical pixels and report differences without authenticity claims', async () => {
    const { image, first } = await fixture();
    const different = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => image,
      readEntries: async () => [first],
    });
    const request = {
      mode: 'compare' as const,
      queryAnchorId: 'anchor',
      selected: first.match.ref,
      selectedCanonicalViewId: first.image.canonicalViewId,
      selectedRegion: null,
    };
    expect(await adapter.compare(request, developmentImageIndex)).toMatchObject(
      {
        success: true,
        data: {
          invocation: null,
          value: {
            selected: first.match.ref,
            similaritiesZhHant: [expect.any(String)],
            differencesZhHant: [],
            citations: [],
          },
        },
      },
    );
    expect(
      await createLocalImageRetrieval({
        index: developmentImageIndex,
        readQuery: async () => ({ ...image, bytes: different }),
        readEntries: async () => [first],
      }).compare(
        {
          ...request,
          selectedCanonicalViewId: null,
          selectedRegion: { kind: 'rect', x: 0, y: 0, width: 0.5, height: 1 },
        },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: true,
      data: {
        value: {
          similaritiesZhHant: [],
          differencesZhHant: [expect.any(String)],
        },
      },
    });
    expect(
      await adapter.compare(
        { ...request, selectedCanonicalViewId: 'missing' },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
  });
  it('should rank equal pixel descriptors deterministically, merge duplicate originals, and paginate', async () => {
    const { image, first, second } = await fixture();
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => image,
      readEntries: async () => [second, first, first],
    });
    const page = await adapter.search(
      { ...query, limit: 1 },
      developmentImageIndex,
    );
    if (!page.success || !page.data.nextCursor) {
      throw new Error('Expected next page');
    }
    expect(page.data.items).toEqual([{ ...first.match, rank: 1 }]);
    expect(
      await adapter.search(
        { ...query, limit: 1, cursor: page.data.nextCursor },
        developmentImageIndex,
      ),
    ).toMatchObject({
      success: true,
      data: { items: [{ ...second.match, rank: 2 }], nextCursor: null },
    });
    expect(
      await adapter.search(
        { ...query, limit: 2, cursor: page.data.nextCursor },
        developmentImageIndex,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });
  it('should keep reference images from different source versions distinct', async () => {
    const { image, first } = await fixture();
    const firstSourceVersion = '50000000-0000-4000-8000-000000000001';
    const secondSourceVersion = '50000000-0000-4000-8000-000000000002';
    const referenceImageId = '60000000-0000-4000-8000-000000000001';
    const entries: ImageSearchEntry[] = [
      secondSourceVersion,
      firstSourceVersion,
    ].map((sourceVersionId) => ({
      ...first,
      match: {
        ...first.match,
        ref: { kind: 'reference', sourceVersionId, referenceImageId },
      },
    }));
    const adapter = createLocalImageRetrieval({
      index: developmentImageIndex,
      readQuery: async () => image,
      readEntries: async () => entries,
    });

    const result = await adapter.search(
      { ...query, scope: 'reference_library' },
      developmentImageIndex,
    );
    if (!result.success) {
      throw new Error('Expected reference search results');
    }

    expect(
      result.data.items.map((match) => ({
        ref: match.ref,
        identity: getImageMatchIdentity(match),
      })),
    ).toEqual([
      {
        ref: {
          kind: 'reference',
          sourceVersionId: firstSourceVersion,
          referenceImageId,
        },
        identity: `${firstSourceVersion}:${referenceImageId}`,
      },
      {
        ref: {
          kind: 'reference',
          sourceVersionId: secondSourceVersion,
          referenceImageId,
        },
        identity: `${secondSourceVersion}:${referenceImageId}`,
      },
    ]);
  });
});
