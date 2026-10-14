import {
  createAnalysisHandler,
  createEditDraftHandler,
  createMediaJobHandler,
  createOutboxDrain,
  createResearchHandler,
  createSourceIngestionHandler,
  createTranscriptionHandler,
} from '@antica/application/server';
import {
  collectorUserId,
  listPendingOutbox,
  processImage,
  processVideoFrames,
} from '@antica/platform';
import {
  createExaWebResearch,
  renderCanonicalImage,
} from '@antica/platform/search';

import { createSourceParser, createTextWriter } from './source-providers.js';
import { drainLlamaWebhooks } from './webhook.js';

import type {
  OperationResult,
  TextRetrievalPort,
} from '@antica/application/ports';
import type {
  MediaProcessorPort,
  SourceImageIndexPort,
} from '@antica/application/server';
import type {
  ConfiguredImageRetrieval,
  QdrantImageWriter,
} from '@antica/platform/search';

import type { ApplicationSettings } from './configuration.js';
import type { Persistence } from './persistence.js';
import type { LlamaWebhookDrainReport } from './webhook.js';

/** carries the configured destination for a prepared collector image */
interface CollectionIndexDestination {
  readonly persistence: Persistence;
  readonly writer: QdrantImageWriter;
}

/** reports durable outbox and verified callback processing together */
export interface ApplicationDrainReport extends Awaited<
  ReturnType<ReturnType<typeof createOutboxDrain>>
> {
  readonly webhooks: LlamaWebhookDrainReport;
}

/** combines provider choices and owner-scoped persistence for durable workers */
export interface JobComposition {
  readonly settings: ApplicationSettings;
  readonly persistence: Persistence;
  readonly images: ConfiguredImageRetrieval;
  readonly text: TextRetrievalPort;
}

/**
 * composes every accepted background job into the persisted leased drain
 * @param params selected providers and persistent capabilities
 * @returns one bounded outbox-drain operation
 */
export function createApplicationDrain(
  params: JobComposition,
): (limit?: number) => Promise<ApplicationDrainReport> {
  const { persistence } = params;
  const { transaction, clock } = persistence;
  const sourceHandler = createSourceHandler(params);
  const drain = createOutboxDrain({
    listPending: async (limit) =>
      listPendingOutbox(persistence.database.db, limit),
    transaction,
    clock,
    handlers: createJobHandlers(params, sourceHandler),
  });

  return async (limit) => {
    const result = await drain(limit);
    const webhooks = await drainLlamaWebhooks(
      persistence.database.db,
      sourceHandler,
      () => clock.now(),
      limit,
    );

    return { ...result, webhooks };
  };
}

/**
 * configures resumable source parsing and index delivery
 * @param params selected provider and persistence capabilities
 * @returns the shared outbox and webhook source handler
 */
function createSourceHandler(
  params: JobComposition,
): ReturnType<typeof createSourceIngestionHandler> {
  const { settings, persistence, images } = params;
  const { transaction, clock, ids } = persistence;
  const knowledge = settings.knowledge;
  const parser = createSourceParser(knowledge, persistence);
  const textWriter = createTextWriter(knowledge, persistence);

  return createSourceIngestionHandler({
    transaction,
    parser,
    clock,
    ids,
    indexing: {
      text:
        knowledge.textDriver === 'local'
          ? { kind: 'local' }
          : {
              kind: 'external',
              index: knowledge.textIndex,
              writer: textWriter,
            },
      image: images.writer
        ? {
            kind: 'external',
            writer: createSourceImageWriter(persistence, images.writer),
          }
        : { kind: 'local' },
    },
  });
}

/**
 * binds each durable message kind to its application worker
 * @param params selected provider and persistence capabilities
 * @param sourceHandler resumable source worker shared with callbacks
 * @returns dispatch handlers for the outbox
 */
function createJobHandlers(
  params: JobComposition,
  sourceHandler: ReturnType<typeof createSourceIngestionHandler>,
): Parameters<typeof createOutboxDrain>[0]['handlers'] {
  const { settings, persistence, images, text } = params;
  const { transaction, storage, clock, ids } = persistence;
  const { models } = settings.models;
  const knowledge = settings.knowledge;

  return {
    media: createMediaJobHandler(
      transaction,
      createMediaProcessor(persistence, images),
      clock,
      ids,
    ),
    analysis: createAnalysisHandler({
      transaction,
      text,
      index: knowledge.textIndex,
      model: models.analysis,
      catalog: models.catalog,
      media: {
        read: async (key) => storage.read(key),
        renderRegion: renderCanonicalImage,
      },
      clock,
    }),
    research: createResearchHandler({
      transaction,
      text,
      web: createExaWebResearch({ apiKey: knowledge.exaApiKey }),
      model: models.research,
      catalog: models.catalog,
      index: knowledge.textIndex,
      selection: settings.models.selections.research,
      clock,
      ids,
    }),
    sourceIngestion: sourceHandler,
    transcription: createTranscriptionHandler(
      transaction,
      models.transcription,
      models.catalog,
      storage,
      clock,
    ),
    recordEditing: createEditDraftHandler(
      transaction,
      models.recordEditing,
      models.catalog,
      clock,
    ),
  };
}

/**
 * connects actual media decoding and optional cloud image indexing
 * @param persistence collector-scoped storage and repositories
 * @param images configured visual index
 * @returns the media processor consumed by the durable worker
 */
function createMediaProcessor(
  persistence: Persistence,
  images: ConfiguredImageRetrieval,
): MediaProcessorPort {
  const writer = images.writer;

  return {
    processImage: async (input) =>
      processImage({ ...input, store: persistence.storage }),
    processVideoFrames: async (input) =>
      processVideoFrames({ ...input, store: persistence.storage }),
    indexImage: writer
      ? async (input) => indexCollectionImage({ persistence, writer }, input)
      : undefined,
  };
}

/**
 * indexes real canonical pixels before the media-ready transaction commits
 * @param params scoped persistence and selected durable writer
 * @param params.persistence owner-scoped storage and record readers
 * @param params.writer configured external image index writer
 * @param input prepared original, derivative, and view identities
 * @returns successful indexing or an explicit provider failure
 */
async function indexCollectionImage(
  params: CollectionIndexDestination,
  input: Parameters<NonNullable<MediaProcessorPort['indexImage']>>[0],
): Promise<OperationResult<void>> {
  const { persistence, writer } = params;
  if (
    input.ownerId !== collectorUserId ||
    input.asset.owner.kind !== 'record'
  ) {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'Image owner is unavailable',
        retryable: false,
      },
    };
  }
  const recordId = input.asset.owner.recordId;
  const selected = await persistence.transaction.run(
    input.ownerId,
    async (unit) => ({
      success: true as const,
      data: await unit.records.get(recordId),
    }),
  );
  if (!selected.data) {
    return {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Image record is unavailable',
        retryable: false,
      },
    };
  }
  const result = await writer.upsert({
    pointId: input.view.id,
    entry: {
      image: {
        originalAssetId: input.asset.id,
        canonicalViewId: input.view.id,
        bytes: (await persistence.storage.read(input.derivative.storageKey))
          .bytes,
        region: null,
      },
      match: collectionMatch(recordId, input),
      filterIds: {
        objectTypeIds: selected.data.categoryIds,
        materialIds: selected.data.materialIds,
        periodIds: [],
        regionIds: [],
        sourceIds: [],
      },
    },
  });

  return result.success ? { success: true, data: undefined } : result;
}

/**
 * indexes persisted source figures after canonical parsing commits
 * @param persistence collector-scoped source readers
 * @param writer selected external image writer
 * @returns a source-image worker hook
 */
function createSourceImageWriter(
  persistence: Persistence,
  writer: QdrantImageWriter,
): SourceImageIndexPort {
  return {
    index: async (ownerId, pack) => {
      if (ownerId !== collectorUserId) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Source owner is unavailable',
            retryable: false,
          },
        };
      }
      const entries = (await persistence.readers.readImageEntries()).flatMap(
        (entry) => {
          const reference = entry.match.ref;

          return reference.kind === 'reference' &&
            reference.sourceVersionId === pack.sourceVersionId
            ? [{ entry, referenceImageId: reference.referenceImageId }]
            : [];
        },
      );
      for (const { entry, referenceImageId } of entries) {
        const indexed = await writer.upsert({
          pointId: referenceImageId,
          entry,
        });
        if (!indexed.success) {
          return indexed;
        }
      }

      return { success: true, data: { indexedCount: entries.length } };
    },
  };
}

/**
 * preserves exact original and canonical derivative identities for visual search
 * @param recordId owning collector record
 * @param input prepared canonical image
 * @returns collection image match metadata
 */
function collectionMatch(
  recordId: string,
  input: Parameters<NonNullable<MediaProcessorPort['indexImage']>>[0],
): Parameters<QdrantImageWriter['upsert']>[0]['entry']['match'] {
  return {
    ref: { kind: 'collection', recordId, originalAssetId: input.asset.id },
    matchingRegions: [
      {
        canonicalViewId: input.view.id,
        region: null,
        derivativeId: input.derivative.id,
      },
    ],
    thumbnail: null,
    sourceLocator: null,
    sourceTitle: null,
    contributorNames: [],
    warningsZhHant: [],
  };
}
