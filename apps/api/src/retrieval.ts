import { collectorUserId } from '@antica/platform';
import {
  createCloudImageComparison,
  createConfiguredImageRetrieval,
  createLlamaTextRetrieval,
  createLocalTextRetrieval,
  developmentImageIndex,
} from '@antica/platform/search';

import type {
  IndexIdentity,
  TextRetrievalPort,
} from '@antica/application/ports';
import type {
  ConfiguredImageRetrieval,
  LlamaRetrievedChunk,
  TextSearchEntry,
} from '@antica/platform/search';

import type { ApplicationSettings } from './configuration.js';
import type { Persistence } from './persistence.js';

/**
 * creates explicitly selected image providers with collector-scoped readers
 * @param settings validated model and image settings
 * @param persistence authenticated media readers
 * @returns selected image retrieval and durable writer
 */
export function createImageProviders(
  settings: ApplicationSettings,
  persistence: Persistence,
): ConfiguredImageRetrieval {
  const { readers } = persistence;
  const config = settings.image;
  const index =
    config.ANTICA_IMAGE_SEARCH_DRIVER === 'local'
      ? developmentImageIndex
      : {
          embeddingModelId: config.IMAGE_EMBEDDING_MODEL_ID!,
          dimensions: config.IMAGE_EMBEDDING_DIMENSIONS!,
          indexVersion: config.IMAGE_INDEX_VERSION!,
        };
  const result = createConfiguredImageRetrieval(
    config.ANTICA_IMAGE_SEARCH_DRIVER === 'disabled'
      ? { driver: 'disabled' }
      : config.ANTICA_IMAGE_SEARCH_DRIVER === 'local'
        ? {
            driver: 'local',
            production: settings.app.NODE_ENV === 'production',
            index,
            readQuery: readers.readQuery,
            readEntries: readers.readImageEntries,
          }
        : {
            driver: 'voyage-qdrant',
            production: settings.app.NODE_ENV === 'production',
            index,
            voyageApiKey: config.VOYAGE_API_KEY!,
            url: config.QDRANT_URL!,
            apiKey: config.QDRANT_API_KEY,
            collection: config.QDRANT_COLLECTION!,
            ownerId: collectorUserId,
            corpusId: config.IMAGE_CORPUS_ID!,
            readQuery: readers.readQuery,
            resolveEntry: async (pointId) =>
              (await readers.readImageEntries()).find(
                (entry) =>
                  (entry.match.ref.kind === 'reference'
                    ? entry.match.ref.referenceImageId
                    : entry.image.canonicalViewId) === pointId,
              ) ?? null,
            compare: createImageComparison(settings, persistence, index),
          },
  );
  if (!result.success) {
    throw new Error(result.error.message);
  }

  return result.data;
}

/**
 * creates text retrieval with exact persisted provider-region mappings
 * @param settings validated source settings
 * @param persistence collector-scoped repositories
 * @returns the selected text retrieval port
 */
export function createTextProvider(
  settings: ApplicationSettings,
  persistence: Persistence,
): TextRetrievalPort {
  const config = settings.knowledge;

  return config.textDriver === 'local'
    ? createLocalTextRetrieval({
        index: config.textIndex,
        readEntries: persistence.readers.readTextEntries,
      })
    : createLlamaTextRetrieval({
        apiKey: config.llamaApiKey,
        indexId: config.indexId!,
        index: config.textIndex,
        ownerId: collectorUserId,
        resolveChunk: async (chunk) =>
          resolveTextChunk(persistence, config.textIndex, chunk),
      });
}

/**
 * resolves provider identity only through retained source-region text
 * @param persistence collector-scoped repositories and readers
 * @param index immutable embedding-space identity
 * @param chunk retrieved provider chunk
 * @returns exact canonical source entry or no match
 */
async function resolveTextChunk(
  persistence: Persistence,
  index: IndexIdentity,
  chunk: LlamaRetrievedChunk,
): Promise<TextSearchEntry | null> {
  const result = await persistence.transaction.run(
    collectorUserId,
    async (unit) => ({
      success: true as const,
      data: await unit.sources.resolveProviderChunk(
        'llama-cloud',
        index.indexVersion,
        `${chunk.fileId}:${chunk.chunkIndex}`,
      ),
    }),
  );
  const mapping = result.data;
  if (!mapping) {
    return null;
  }

  return (
    (await persistence.readers.readTextEntries()).find(
      (entry) =>
        entry.sourceRegionId !== null &&
        mapping.canonicalRegionIds.includes(entry.sourceRegionId) &&
        entry.citation.locator.sourceVersionId === mapping.sourceVersionId &&
        entry.contentAsRetrieved === chunk.contentAsRetrieved,
    ) ?? null
  );
}

/**
 * binds the research vision role to owner-scoped exact image identities
 * @param settings validated model settings
 * @param persistence collector-scoped image readers
 * @param index frozen image index identity
 * @returns configured comparison operation
 */
function createImageComparison(
  settings: ApplicationSettings,
  persistence: Persistence,
  index: IndexIdentity,
): ReturnType<typeof createCloudImageComparison> {
  const { readers } = persistence;

  return createCloudImageComparison({
    models: {
      profiles: settings.models.models.profiles,
      gatewayApiKey: settings.modelConfig.gatewayApiKey,
      openAiApiKey: settings.modelConfig.openAiApiKey,
    },
    selection: settings.models.selections.research,
    index,
    readQuery: readers.readQuery,
    readSelected: async (request) =>
      (await readers.readImageEntries()).find(
        (entry) =>
          JSON.stringify(entry.match.ref) ===
            JSON.stringify(request.selected) &&
          (!request.selectedCanonicalViewId ||
            entry.image.canonicalViewId === request.selectedCanonicalViewId),
      ) ?? null,
  });
}
