import {
  collectorUserId,
  createLlamaSourceParser,
  createLocalSourceParser,
  createSourceArtifactAccess,
} from '@antica/platform';
import { createLlamaTextIndexWriter } from '@antica/platform/search';

import type {
  DurableSourceParsingPort,
  DurableTextIndexWriterPort,
  SourceParsingPort,
} from '@antica/application/ports';
import type { KnowledgeConfiguration } from '@antica/platform';

import type { Persistence } from './persistence.js';

/** binds all parser side effects to one immutable source version and run */
type SourceRun = {
  readonly sourceVersionId: string;
  readonly parseRunId: string;
};

/**
 * creates parsing with per-run authorized original and artifact access
 * @param config validated source provider settings
 * @param persistence collector-scoped persistence
 * @returns selected parser with durable resume where supported
 */
export function createSourceParser(
  config: KnowledgeConfiguration,
  persistence: Persistence,
): SourceParsingPort | DurableSourceParsingPort {
  return config.parsingDriver === 'local'
    ? {
        parse: async (input) =>
          createLocalSourceParser(sourceArtifacts(persistence, input)).parse(
            input,
          ),
      }
    : {
        submit: async (input) =>
          createLlamaSourceParser({
            ...sourceArtifacts(persistence, input),
            apiKey: config.llamaApiKey,
            parserVersion: config.parserVersion!,
            webhook: config.webhook,
          }).submit(input),
        resume: async (handle) =>
          createLlamaSourceParser({
            ...sourceArtifacts(persistence, handle),
            apiKey: config.llamaApiKey,
            parserVersion: config.parserVersion!,
            webhook: config.webhook,
          }).resume(handle),
      };
}

/**
 * binds text indexing checkpoints to their source version and parse run
 * @param config validated index provider settings
 * @param persistence collector-scoped persistence
 * @returns a resumable index writer
 */
export function createTextWriter(
  config: KnowledgeConfiguration,
  persistence: Persistence,
): DurableTextIndexWriterPort {
  const forRun = (run: SourceRun): DurableTextIndexWriterPort => {
    const artifacts = sourceArtifacts(persistence, run);

    return createLlamaTextIndexWriter({
      apiKey: config.llamaApiKey,
      indexId: config.indexId!,
      sourceDirectoryId: config.sourceDirectoryId!,
      index: config.textIndex,
      ownerId: collectorUserId,
      readCheckpoint: async (assetId) =>
        (await artifacts.readArtifact(assetId)).bytes,
      writeCheckpoint: async (bytes) =>
        artifacts.writeArtifact(bytes, 'application/json'),
    });
  };

  return {
    submit: async (input) => forRun(input).submit(input),
    resume: async (handle) => forRun(handle).resume(handle),
  };
}

/**
 * authorizes durable artifacts and original bytes for one source run
 * @param persistence collector-scoped persistence
 * @param run immutable source and parse-run identities
 * @returns scoped parser storage callbacks
 */
function sourceArtifacts(
  persistence: Persistence,
  run: SourceRun,
): ReturnType<typeof createSourceArtifactAccess> {
  return createSourceArtifactAccess({
    db: persistence.database.db,
    storage: persistence.storage,
    ownerId: collectorUserId,
    ...run,
  });
}
