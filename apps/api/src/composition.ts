import {
  createAnalysisService,
  createEditDraftService,
  createEvidenceService,
  createImageSearchService,
  createJobService,
  createKnowledgeService,
  createLocationService,
  createMediaService,
  createRecordService,
  createResearchService,
  createSourceService,
  createTranscriptionService,
} from '@antica/application/server';

import { createApplication } from './application.js';
import { createApplicationDrain } from './jobs.js';
import { createPersistence } from './persistence.js';
import { createImageProviders, createTextProvider } from './retrieval.js';
import { createLlamaWebhookReceiver } from './webhook.js';

import type {
  IndexIdentity,
  TextRetrievalPort,
} from '@antica/application/ports';
import type { ConfiguredImageRetrieval } from '@antica/platform/search';

import type { ApplicationParams } from './application.js';
import type { ApplicationSettings } from './configuration.js';
import type { JobComposition } from './jobs.js';
import type { Persistence } from './persistence.js';

export {
  readApplicationConfig,
  readImageConfiguration,
} from './configuration.js';
export type {
  ApplicationConfig,
  ApplicationSettings,
  ImageConfiguration,
} from './configuration.js';

/** exposes one closable persistent application and its bounded worker entry */
export interface ApplicationRuntime extends Persistence {
  readonly app: ReturnType<typeof createApplication>;
  readonly text: TextRetrievalPort;
  readonly textIndex: IndexIdentity;
  readonly images: ConfiguredImageRetrieval['port'];
  readonly imageIndex: IndexIdentity;
  readonly imageWriter: ConfiguredImageRetrieval['writer'];
  readonly drain: ReturnType<typeof createApplicationDrain>;
  readonly close: () => Promise<void>;
}

/**
 * composes a persistent application without migrating or starting a listener
 * @param settings fully validated server and provider settings
 * @returns a closable API and durable job runtime
 */
export async function composeApplication(
  settings: ApplicationSettings,
): Promise<ApplicationRuntime> {
  const persistence = await createPersistence(settings.app);
  try {
    const images = createImageProviders(settings, persistence);
    const text = createTextProvider(settings, persistence);
    const dependencies = { settings, persistence, images, text };

    return {
      ...persistence,
      app: createHttpApplication(dependencies),
      text,
      textIndex: settings.knowledge.textIndex,
      images: images.port,
      imageIndex: images.index,
      imageWriter: images.writer,
      drain: createApplicationDrain(dependencies),
      close: persistence.database.close,
    };
  } catch (cause) {
    await persistence.database.close();
    throw cause;
  }
}

/**
 * binds authenticated HTTP routes to the same persistent worker capabilities
 * @param dependencies configured services and persistence
 * @returns the listener-independent Hono application
 */
function createHttpApplication(
  dependencies: JobComposition,
): ReturnType<typeof createApplication> {
  const { persistence } = dependencies;
  const { local } = persistence;

  const app = createApplication({
    auth: persistence.auth,
    allowedOrigins: persistence.trustedOrigins,
    ...createRecordServices(dependencies.settings, persistence),
    ...createKnowledgeServices(dependencies),
    localTransfers: local
      ? {
          validateUploadToken: async (token) =>
            local.validateUploadToken(token),
          acceptUploadToken: local.acceptUploadToken.bind(local),
          openReadToken: local.openReadToken.bind(local),
        }
      : undefined,
  });
  const webhook = dependencies.settings.knowledge.webhook;
  if (webhook) {
    const receive = createLlamaWebhookReceiver(
      persistence.database.db,
      webhook.signingSecret,
      () => persistence.clock.now(),
    );
    app.post('/webhooks/llama-parse', async (context) =>
      receive(context.req.raw),
    );
  }

  return app;
}

/**
 * composes collector records, evidence, voice, and explicit analysis commands
 * @param settings configured model role selections
 * @param persistence collector-scoped persistent capabilities
 * @returns collection and evidence route dependencies
 */
function createRecordServices(
  settings: ApplicationSettings,
  persistence: Persistence,
): Pick<
  ApplicationParams,
  | 'records'
  | 'locations'
  | 'media'
  | 'evidence'
  | 'analysis'
  | 'jobs'
  | 'transcriptions'
  | 'edits'
> {
  const { transaction, storage, clock, ids } = persistence;
  const { models, selections } = settings.models;

  return {
    records: createRecordService(transaction, clock, ids, storage),
    locations: createLocationService(transaction, ids),
    media: createMediaService(transaction, storage, clock, ids),
    evidence: createEvidenceService(transaction, clock, ids),
    analysis: createAnalysisService(
      transaction,
      models.catalog,
      selections.analysis,
      clock,
      ids,
    ),
    jobs: createJobService(transaction),
    transcriptions: createTranscriptionService(
      transaction,
      selections.transcription,
      clock,
      ids,
    ),
    edits: createEditDraftService(
      transaction,
      selections.recordEditing,
      clock,
      ids,
    ),
  };
}

/**
 * composes source, knowledge, research, and image operations
 * @param dependencies selected retrieval and persistent capabilities
 * @returns research route dependencies
 */
function createKnowledgeServices(
  dependencies: JobComposition,
): Pick<ApplicationParams, 'sources' | 'knowledge' | 'research' | 'images'> {
  const { persistence, images } = dependencies;
  const { transaction, clock, ids } = persistence;

  return {
    sources: createSourceService(transaction, clock, ids, persistence.storage),
    knowledge: createKnowledgeService(transaction, clock, ids),
    research: createResearchService(transaction, clock, ids),
    images: createImageSearchService({
      transaction,
      images: images.port,
      index: images.index,
      clock,
      ids,
    }),
  };
}
