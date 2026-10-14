import { failure } from './failure.js';
import { parseSource, selectParsedPages } from './parse.js';
import { prepareSourceIngestion } from './prepare.js';
import { publishAggregate, publishFinal } from './publication.js';
import { selectTextIndexOutcome } from './text-index.js';

import type { OperationResult, ParsedSourcePack } from '../../ports/index.js';

import type {
  SourceIngestionHandlerParams,
  SourceIndexingParams,
} from '../ingestion.js';

import type { PreparedSource } from './prepare.js';

interface SourceJobParams extends SourceIngestionHandlerParams {
  readonly indexing: SourceIndexingParams;
  readonly ownerId: string;
  readonly jobId: string;
}

interface FinishIndexingParams extends SourceJobParams {
  readonly prepared: PreparedSource;
  readonly pack: ParsedSourcePack;
}

const localIndexing: SourceIndexingParams = {
  text: { kind: 'local' },
  image: { kind: 'local' },
};

/**
 * binds the existing parse, publication and indexing stages to an authorized job
 * @param params collector transaction, parser, allocators and selected indexes
 * @returns resumable owner-scoped worker, including pending durable outcomes
 */
export function createSourceIngestionHandler(
  params: SourceIngestionHandlerParams,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  const indexing = params.indexing ?? localIndexing;

  return async (ownerId, jobId) =>
    runSourceJob({ ...params, indexing, ownerId, jobId });
}

/**
 * prepares, parses and publishes the selected canonical rows before indexing
 * @param params authorized source job and configured stage ports
 * @returns processing outcome, including durable pending and saved replay states
 */
async function runSourceJob(
  params: SourceJobParams,
): Promise<OperationResult<void>> {
  const { transaction, parser, clock, ids, ownerId, jobId } = params;
  const prepared = await prepareSourceIngestion({
    transaction,
    clock,
    ownerId,
    jobId,
  });
  if (!prepared.success) {
    return prepared;
  }
  if (prepared.data.done) {
    return { success: true, data: undefined };
  }
  const parsed = await parseSource({
    transaction,
    parser,
    clock,
    ids,
    ownerId,
    jobId,
    version: prepared.data.version,
    pageIds: prepared.data.pageIds,
  });
  if (!parsed.success) {
    return parsed;
  }
  if (!parsed.data.pack) {
    return { success: true, data: undefined };
  }
  const pack = prepared.data.pageIds
    ? selectParsedPages(parsed.data.pack, prepared.data.pageIds)
    : parsed.data.pack;
  if (!pack) {
    return failure(
      'SOURCE_UNAVAILABLE',
      'Selected pages were not found in the parsed source version',
    );
  }
  if (!parsed.data.savedPack) {
    const stored = await publishAggregate({
      transaction,
      ownerId,
      jobId,
      versionId: prepared.data.version.id,
      pageIds: prepared.data.pageIds,
      pack,
      clock,
      ids,
    });
    if (!stored.success) {
      return stored;
    }
  }

  return finishIndexing({ ...params, prepared: prepared.data, pack });
}

/**
 * runs the selected writers and completes the active version in its final transaction
 * @param params published pack, captured base and configured index writers
 * @returns final publication or pending/failing writer outcome
 */
async function finishIndexing(
  params: FinishIndexingParams,
): Promise<OperationResult<void>> {
  const { transaction, indexing, ownerId, jobId, pack, clock, prepared } =
    params;
  const textResult = await selectTextIndexOutcome({
    transaction,
    config: indexing.text,
    ownerId,
    jobId,
    pack,
    clock,
  });
  if (!textResult.success) {
    return textResult;
  }
  if (!textResult.data) {
    return { success: true, data: undefined };
  }
  const imageResult =
    indexing.image.kind === 'local'
      ? { success: true as const, data: { indexedCount: pack.images.length } }
      : await indexing.image.writer.index(ownerId, pack);
  if (!imageResult.success) {
    return imageResult;
  }

  return publishFinal({
    transaction,
    ownerId,
    jobId,
    versionId: prepared.version.id,
    pageIds: prepared.pageIds,
    pack,
    clock,
    base: prepared.base,
    indexedText: textResult.data,
    indexedImageCount: imageResult.data.indexedCount,
  });
}
