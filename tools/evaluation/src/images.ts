import { performance } from 'node:perf_hooks';

import {
  createLocalImageRetrieval,
  developmentImageIndex,
} from '@antica/platform/search';

import { readFile } from 'node:fs/promises';

import { digestSnapshot } from './digest.js';
import { scoreRetrieval } from './metrics.js';

import type { IndexIdentity } from '@antica/application/ports';
import type { ImageSearchEntry } from '@antica/platform/search';

import type { RetrievalScores } from './metrics.js';

/** describes a measured fixture-image retrieval result */
export interface ImageRetrievalReport {
  readonly adapterKind: 'development';
  readonly metric: 'rgb-grid-distance';
  readonly rankedIds: readonly string[];
  readonly scores: RetrievalScores | null;
  readonly index: IndexIdentity;
  readonly fixtureDigest: string;
  readonly elapsedMs: number;
  readonly error: unknown;
  readonly limitations: readonly string[];
}

const imageLimitations = [
  'Authored solid-color PNGs measure pixel-pipeline behavior only.',
  'The RGB grid is a deterministic descriptor, not a learned embedding or authenticity classifier.',
];

/**
 * evaluates actual synthetic pixels against an independently configured image index
 * @returns image-only ranking metrics and explicit development labeling
 */
export async function evaluateImages(): Promise<ImageRetrievalReport> {
  const pixels = await Promise.all(
    ['blue', 'red', 'dark-red'].map(async (color) =>
      readFile(new URL(`../fixtures/${color}.png`, import.meta.url)),
    ),
  );
  const entries = createImageEntries(pixels);
  const queryBytes = await readFile(
    new URL('../fixtures/red.png', import.meta.url),
  );
  const queryId = '40000000-0000-4000-8000-000000000009';
  const adapter = createLocalImageRetrieval({
    index: developmentImageIndex,
    readEntries: async () => entries,
    readQuery: async () => ({
      originalAssetId: queryId,
      canonicalViewId: queryId,
      bytes: queryBytes,
      region: null,
    }),
  });
  const start = performance.now();
  const result = await adapter.search(
    {
      mode: 'search',
      queryAnchorId: queryId,
      scope: 'my_collection',
      filters: {},
      includeWholeImage: true,
      limit: 1,
    },
    developmentImageIndex,
  );
  const rankedIds = result.success
    ? result.data.items.map((item) =>
        item.ref.kind === 'collection'
          ? item.ref.originalAssetId
          : item.ref.referenceImageId,
      )
    : [];

  return {
    adapterKind: 'development',
    metric: 'rgb-grid-distance',
    index: developmentImageIndex,
    fixtureDigest: digestSnapshot(
      pixels.map((bytes) => bytes.toString('base64')),
    ),
    elapsedMs: performance.now() - start,
    rankedIds,
    scores: result.success
      ? scoreRetrieval({
          rankedIds,
          relevance: { '40000000-0000-4000-8000-000000000002': 3 },
          limit: 1,
        })
      : null,
    error: result.success ? null : result.error,
    limitations: imageLimitations,
  };
}

/**
 * constructs independently identified candidates from actual fixture pixels
 * @param pixels authored PNG bytes
 * @returns image entries accepted by the image retrieval adapter
 */
function createImageEntries(pixels: readonly Uint8Array[]): ImageSearchEntry[] {
  return pixels.map((bytes, index) => {
    const id = `40000000-0000-4000-8000-00000000000${index + 1}`;

    return {
      image: { originalAssetId: id, canonicalViewId: id, bytes, region: null },
      match: {
        ref: { kind: 'collection', recordId: id, originalAssetId: id },
        matchingRegions: [
          { canonicalViewId: id, region: null, derivativeId: null },
        ],
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
  });
}
