import { describe, expect, it, vi } from 'vitest';

import { createConfiguredImageRetrieval } from './config.js';
import { developmentImageIndex } from './image.js';

describe('fn:createConfiguredImageRetrieval', () => {
  it('should reject disabled image operations without contacting a provider', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Unexpected network'));
    const result = createConfiguredImageRetrieval({ driver: 'disabled' });
    if (!result.success) {
      throw new Error('Disabled capability must compose');
    }
    expect(result.data.writer).toBeNull();
    expect(
      await result.data.port.search(
        {
          mode: 'search',
          queryAnchorId: 'anchor',
          scope: 'my_collection',
          includeWholeImage: false,
          filters: {},
        },
        result.data.index,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      await result.data.port.compare(
        {
          mode: 'compare',
          queryAnchorId: 'anchor',
          selected: {
            kind: 'collection',
            recordId: 'record',
            originalAssetId: 'asset',
          },
          selectedCanonicalViewId: null,
          selectedRegion: null,
        },
        result.data.index,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('should allow the development index locally and reject a different local descriptor space', async () => {
    const readQuery = vi.fn(async () => {
      throw new Error('Unexpected read');
    });
    const params = {
      driver: 'local' as const,
      production: false,
      index: developmentImageIndex,
      readQuery,
      readEntries: async () => [],
    };
    const configured = createConfiguredImageRetrieval(params);
    if (!configured.success) {
      throw new Error('Expected development configuration');
    }
    expect(configured.data.writer).toBeNull();
    const foreign = { ...developmentImageIndex, indexVersion: 'foreign' };
    expect(
      await configured.data.port.search(
        {
          mode: 'search',
          queryAnchorId: 'anchor',
          scope: 'my_collection',
          includeWholeImage: false,
          filters: {},
        },
        foreign,
      ),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(
      createConfiguredImageRetrieval({ ...params, index: foreign }),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(readQuery.mock.calls).toEqual([]);
  });
  it('should expose a configured cloud writer and route comparison through its authorized operation', async () => {
    const index = {
      embeddingModelId: 'voyage-multimodal-3',
      dimensions: 1024,
      indexVersion: 'v1',
    };
    const failure = {
      success: false as const,
      audit: { invocation: null, rawOutput: null },
      error: {
        code: 'SOURCE_UNAVAILABLE' as const,
        message: 'Selected image unavailable',
        retryable: false,
      },
    };
    const result = createConfiguredImageRetrieval({
      driver: 'voyage-qdrant',
      production: true,
      voyageApiKey: 'test-key',
      url: 'https://qdrant.example.org',
      collection: 'images',
      ownerId: 'owner',
      corpusId: 'catalog',
      index,
      readQuery: async () => {
        throw new Error('Unexpected read');
      },
      resolveEntry: async () => null,
      compare: async () => failure,
    });
    if (!result.success) {
      throw new Error('Expected configured cloud adapter');
    }
    expect(result.data.index).toEqual(index);
    expect(result.data.writer).not.toBeNull();
    expect(
      await result.data.port.compare(
        {
          mode: 'compare',
          queryAnchorId: 'anchor',
          selected: {
            kind: 'collection',
            recordId: 'record',
            originalAssetId: 'asset',
          },
          selectedCanonicalViewId: null,
          selectedRegion: null,
        },
        index,
      ),
    ).toEqual(failure);
  });
  it('should reject the local descriptor in production before reading any images', () => {
    const readQuery = vi.fn(async () => {
      throw new Error('Image read must not occur during configuration');
    });
    const readEntries = vi.fn(async () => []);
    expect(
      createConfiguredImageRetrieval({
        driver: 'local',
        production: true,
        index: developmentImageIndex,
        readQuery,
        readEntries,
      }),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(readQuery).not.toHaveBeenCalled();
    expect(readEntries).not.toHaveBeenCalled();
  });

  it.each([512, 2048])(
    'should reject a cloud manifest with %i dimensions before contacting a provider',
    (dimensions) => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Unexpected network request'));
      const result = createConfiguredImageRetrieval({
        driver: 'voyage-qdrant',
        production: true,
        voyageApiKey: 'acceptance-key',
        url: 'https://qdrant.example.org',
        collection: 'acceptance',
        ownerId: 'collector',
        corpusId: 'catalog',
        index: {
          embeddingModelId: 'voyage-multimodal-3',
          dimensions,
          indexVersion: '1',
        },
        readQuery: async () => {
          throw new Error('No image is read at startup');
        },
        resolveEntry: async () => null,
        compare: async () => ({
          success: false,
          audit: { invocation: null, rawOutput: null },
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'No image selected',
            retryable: false,
          },
        }),
      });
      expect(result).toMatchObject({
        success: false,
        error: { code: 'INDEX_NOT_READY' },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );
});
