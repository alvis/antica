import { compareImages } from './image/comparison.js';
import { searchImages } from './image/search.js';
import { validateIndexSpace } from './index-space.js';

import type {
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
} from '@antica/application/ports';
import type { ImageMatch } from '@antica/contracts';
import type { Region } from '@antica/domain';

export { getImageMatchIdentity } from './image/matches.js';

/** identifies a canonical image whose bytes already match the displayed view */
export interface SearchImage {
  readonly originalAssetId: string;
  readonly canonicalViewId: string;
  readonly bytes: Uint8Array;
  readonly region: Region | null;
}

/** joins actual pixels with stable source or collection identity */
export interface ImageSearchEntry {
  readonly image: SearchImage;
  readonly match: Omit<ImageMatch, 'rank'>;
  readonly filterIds: {
    readonly objectTypeIds: readonly string[];
    readonly materialIds: readonly string[];
    readonly periodIds: readonly string[];
    readonly regionIds: readonly string[];
    readonly sourceIds: readonly string[];
  };
}

/** injects authorized images and the persisted descriptor space */
export interface LocalImageRetrievalParams {
  readonly index: IndexIdentity;
  readonly readQuery: (anchorId: string) => Promise<SearchImage>;
  readonly readEntries: () => Promise<readonly ImageSearchEntry[]>;
}

/** records the independent development descriptor version */
export const developmentImageIndex: IndexIdentity = {
  embeddingModelId: 'development:rgb-grid-v1',
  dimensions: 192,
  indexVersion: 'rgb-grid-v1',
};

/**
 * searches actual image content with a labeled development descriptor
 * @param params authorized image readers and index identity
 * @returns retrieval port
 */
export function createLocalImageRetrieval(
  params: LocalImageRetrievalParams,
): ImageRetrievalPort {
  return {
    search: async (query, index) => {
      const compatibility = checkIndex(params.index, index);
      if (!compatibility.success) {
        return compatibility;
      }

      return searchImages(params, query, index);
    },
    compare: async (query, index) => {
      const compatibility = checkIndex(params.index, index);
      if (!compatibility.success) {
        return {
          ...compatibility,
          audit: { invocation: null, rawOutput: null },
        };
      }

      return compareImages(params, query);
    },
  };
}

/**
 * checks both image indexes against the declared descriptor space
 * @param stored stored image index identity
 * @param query requested query index identity
 * @returns compatibility result
 */
function checkIndex(
  stored: IndexIdentity,
  query: IndexIdentity,
): OperationResult<null> {
  return validateIndexSpace(stored, query).valid &&
    validateIndexSpace(developmentImageIndex, stored).valid
    ? { success: true, data: null }
    : {
        success: false,
        error: {
          code: 'INDEX_NOT_READY',
          message: 'The query and image index use different descriptor spaces.',
          retryable: false,
        },
      };
}
