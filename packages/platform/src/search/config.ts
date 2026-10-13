import { createLocalImageRetrieval, developmentImageIndex } from './image.js';
import { validateIndexSpace } from './index-space.js';
import {
  createQdrantImageRetrieval,
  createQdrantImageWriter,
} from './qdrant.js';
import { createVoyageImageEmbedding } from './voyage.js';

import type { LocalImageRetrievalParams } from './image.js';
import type {
  QdrantImageRetrievalParams,
  QdrantImageWriter,
} from './qdrant.js';
import type {
  ImageRetrievalPort,
  IndexIdentity,
  OperationResult,
} from '@antica/application/ports';

/** keeps the local descriptor profile explicit and development-only */
export interface LocalImageRetrievalConfig extends LocalImageRetrievalParams {
  readonly driver: 'local';
  readonly production: boolean;
}

/** selects cloud image search independently from inference model selection */
export interface CloudImageRetrievalConfig extends Omit<
  QdrantImageRetrievalParams,
  'embedding'
> {
  readonly driver: 'voyage-qdrant';
  readonly production: boolean;
  readonly voyageApiKey: string;
}

/** selects exactly one image adapter without fallback */
export type ConfiguredImageRetrievalParams =
  LocalImageRetrievalConfig | CloudImageRetrievalConfig;

/** exposes the selected immutable index and optional cloud ingestion capability */
export interface ConfiguredImageRetrieval {
  readonly port: ImageRetrievalPort;
  readonly index: IndexIdentity;
  readonly writer: QdrantImageWriter | null;
}

/**
 * composes an explicit image retrieval driver and rejects incomplete deployment configuration
 * @param params separate image driver, credentials, manifest, and authorized readers
 * @returns selected retrieval capabilities or configuration failure
 */
export function createConfiguredImageRetrieval(
  params: ConfiguredImageRetrievalParams,
): OperationResult<ConfiguredImageRetrieval> {
  if (params.driver === 'local') {
    if (
      params.production ||
      !validateIndexSpace(params.index, developmentImageIndex).valid
    ) {
      return {
        success: false,
        error: {
          code: 'INDEX_NOT_READY',
          message:
            'Local image retrieval requires development mode and its development descriptor index.',
          retryable: false,
        },
      };
    }

    return {
      success: true,
      data: {
        port: createLocalImageRetrieval(params),
        index: params.index,
        writer: null,
      },
    };
  }
  if (
    !params.voyageApiKey.trim() ||
    !params.url.trim() ||
    !params.collection.trim() ||
    !params.ownerId.trim() ||
    !params.corpusId.trim() ||
    !params.index.indexVersion.trim() ||
    params.index.dimensions !== 1024 ||
    !['voyage-multimodal-3', 'voyage-multimodal-3.5'].includes(
      params.index.embeddingModelId,
    )
  ) {
    return {
      success: false,
      error: {
        code: 'INDEX_NOT_READY',
        message:
          'Voyage/Qdrant image retrieval requires explicit credentials, collection, owner, corpus, and a supported 1,024-dimensional index manifest.',
        retryable: false,
      },
    };
  }
  const embedding = createVoyageImageEmbedding({
    apiKey: params.voyageApiKey,
    index: params.index,
  });
  const cloud = { ...params, embedding };

  return {
    success: true,
    data: {
      port: createQdrantImageRetrieval(cloud),
      index: params.index,
      writer: createQdrantImageWriter(cloud),
    },
  };
}
