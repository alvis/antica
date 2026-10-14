import { failure } from './failure.js';
import {
  isParsedSourcePack,
  isParsingHandle,
  saveParseProgress,
} from './parse/checkpoint.js';

import type { SourceVersion } from '@antica/domain';

import type {
  ClockPort,
  DurableSourceParsingPort,
  IdPort,
  JobStep,
  OperationResult,
  ParsedSourcePack,
  SourceParsingPort,
  TransactionPort,
} from '../../ports/index.js';

/** inputs for reading or running one source parse */
export interface ParseSourceParams {
  readonly transaction: TransactionPort;
  readonly parser: SourceParsingPort | DurableSourceParsingPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly ownerId: string;
  readonly jobId: string;
  readonly version: SourceVersion;
  readonly pageIds: readonly string[] | undefined;
}

/** aggregate parse result and whether it was saved before this invocation */
export interface ParseSourceResult {
  readonly pack: ParsedSourcePack | null;
  readonly savedPack: boolean;
}

/** inputs for saving a provider parse failure in the existing transaction */
export interface ParseFailureParams {
  readonly transaction: TransactionPort;
  readonly clock: ClockPort;
  readonly ids: IdPort;
  readonly ownerId: string;
  readonly jobId: string;
  readonly parsed: Extract<
    OperationResult<ParsedSourcePack | null>,
    { readonly success: false }
  >;
}

interface DurableParseParams {
  readonly transaction: TransactionPort;
  readonly parser: DurableSourceParsingPort;
  readonly clock: ClockPort;
  readonly ownerId: string;
  readonly jobId: string;
  readonly version: SourceVersion;
}

interface ParseAssetParams extends DurableParseParams {
  readonly assetId: string;
}

/**
 * reads the aggregate checkpoint before choosing the direct or durable parser
 * @param params existing parse dependencies and selected-page identity
 * @returns saved or new parsed pack, or null while durable work waits
 */
export async function parseSource(
  params: ParseSourceParams,
): Promise<OperationResult<ParseSourceResult>> {
  const { transaction, parser, clock, ids, ownerId, jobId, version, pageIds } =
    params;
  const aggregate = await transaction.run<OperationResult<JobStep | null>>(
    ownerId,
    async (unit) => ({
      success: true,
      data: await unit.jobs.getStep(jobId, 'parse:aggregate'),
    }),
  );
  if (!aggregate.success) {
    return aggregate;
  }
  const savedPack =
    aggregate.data?.state === 'completed' &&
    isParsedSourcePack(aggregate.data.result)
      ? aggregate.data.result
      : null;
  const parsed: OperationResult<ParsedSourcePack | null> = savedPack
    ? { success: true, data: savedPack }
    : 'parse' in parser
      ? await parser.parse({
          sourceVersionId: version.id,
          parseRunId: jobId,
          originalAssetIds: version.originalAssetIds,
          pageIds,
        })
      : await parseDurably({
          transaction,
          parser,
          clock,
          ownerId,
          jobId,
          version,
        });

  if (!parsed.success) {
    const recorded = await recordParseFailure({
      transaction,
      clock,
      ids,
      ownerId,
      jobId,
      parsed,
    });

    return recorded.success
      ? { success: false, error: parsed.error, cause: parsed.cause }
      : recorded;
  }

  return {
    success: true,
    data: { pack: parsed.data, savedPack: Boolean(savedPack) },
  };
}

/**
 * restricts a parsed pack to the requested reprocessing pages
 * @param pack complete parsed source pack
 * @param pageIds canonical page IDs selected by the collector
 * @returns restricted pack, or null if a selected page was not parsed
 */
export function selectParsedPages(
  pack: ParsedSourcePack,
  pageIds: readonly string[],
): ParsedSourcePack | null {
  const selected = new Set(pageIds);
  const pages = pack.pages.filter((page) => selected.has(page.id));
  if (pages.length !== selected.size) {
    return null;
  }

  return {
    ...pack,
    pages,
    regions: pack.regions.filter((region) => selected.has(region.pageId)),
    images: pack.images.filter(
      (image) =>
        image.locator.kind === 'page' && selected.has(image.locator.pageId),
    ),
    warnings: pack.warnings.filter(
      (warning) => warning.pageId === null || selected.has(warning.pageId),
    ),
  };
}

/**
 * saves parser failure state without publishing an incomplete source
 * @param params owner-scoped transaction, active job and parser failure
 * @returns save outcome; caller propagates the original parser error on success
 */
async function recordParseFailure(
  params: ParseFailureParams,
): Promise<OperationResult<void>> {
  const { transaction, clock, ids, ownerId, jobId, parsed } = params;

  return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
    const job = await unit.jobs.get(jobId);
    if (!job) {
      return failure('NOT_FOUND', 'Source job not found');
    }
    if (
      !(await unit.jobs.update(
        {
          ...job,
          state: {
            kind: 'failed',
            error: { ...parsed.error, requestId: ids.create() },
          },
          updatedAt: clock.now(),
        },
        job.updatedAt,
      ))
    ) {
      return failure(
        'REVISION_CONFLICT',
        'Source job changed during failure save',
      );
    }
    const version = await unit.sources.getVersion(job.resourceId);
    if (!version) {
      return failure('NOT_FOUND', 'Source version not found');
    }
    if (
      version.status !== 'processing' ||
      version.activeParseRunId !== jobId ||
      !(await unit.sources.updateVersion(
        {
          ...version,
          status: 'failed',
          textIndexStatus: 'failed',
          imageIndexStatus: 'failed',
        },
        'processing',
        jobId,
      ))
    ) {
      return failure(
        'REVISION_CONFLICT',
        'Source version changed during failure save',
      );
    }

    return { success: true, data: undefined };
  });
}

/**
 * resumes each original asset and combines completed provider packs
 * @param params durable parser, checkpoint transaction and original asset order
 * @returns combined pack, or null when a provider remains pending
 */
async function parseDurably(
  params: DurableParseParams,
): Promise<OperationResult<ParsedSourcePack | null>> {
  const packs: ParsedSourcePack[] = [];
  for (const assetId of params.version.originalAssetIds) {
    const parsed = await parseAsset({ ...params, assetId });
    if (!parsed.success) {
      return parsed;
    }
    if (!parsed.data) {
      return { success: true, data: null };
    }
    packs.push(parsed.data);
  }

  return {
    success: true,
    data: combinePacks({
      versionId: params.version.id,
      jobId: params.jobId,
      packs,
    }),
  };
}

/**
 * reads one asset checkpoint, calls the provider outside a transaction and saves progress
 * @param params durable parser state for one original asset
 * @returns completed asset pack, or null while waiting
 */
async function parseAsset(
  params: ParseAssetParams,
): Promise<OperationResult<ParsedSourcePack | null>> {
  const { transaction, parser, ownerId, jobId, version, assetId } = params;
  const stepName = `parse:${assetId}`;
  const current = await transaction.run<
    OperationResult<{ readonly step: JobStep | null }>
  >(ownerId, async (unit) => ({
    success: true,
    data: { step: await unit.jobs.getStep(jobId, stepName) },
  }));
  if (!current.success) {
    return current;
  }
  const step = current.data.step;
  if (step?.state === 'completed') {
    return isParsedSourcePack(step.result)
      ? { success: true, data: step.result }
      : failure('SOURCE_UNAVAILABLE', 'Saved parse result is unavailable');
  }
  const handle =
    step?.state === 'waiting' && isParsingHandle(step.checkpoint)
      ? step.checkpoint
      : null;
  const progress = handle
    ? await parser.resume(handle)
    : await parser.submit({
        sourceVersionId: version.id,
        parseRunId: jobId,
        originalAssetId: assetId,
      });
  if (!progress.success) {
    return progress;
  }
  const saved = await saveParseProgress({
    ...params,
    step,
    stepName,
    handle,
    progress,
  });
  if (!saved.success) {
    return saved;
  }

  return progress.data.kind === 'waiting'
    ? { success: true, data: null }
    : { success: true, data: progress.data.pack };
}

/**
 * combines original-asset packs while preserving canonical page indices and image locators
 * @param params registered version, parse run and completed packs in original-asset order
 * @param params.versionId registered source version identity
 * @param params.jobId current parse run identity
 * @param params.packs completed packs in original-asset order
 * @returns one canonical source pack
 */
function combinePacks(params: {
  readonly versionId: string;
  readonly jobId: string;
  readonly packs: readonly ParsedSourcePack[];
}): ParsedSourcePack {
  const { versionId, jobId, packs } = params;
  const pages = packs
    .flatMap((pack) => pack.pages)
    .map((page, pageIndex) => ({ ...page, pageIndex }));
  const pageIndexes = new Map(pages.map((page) => [page.id, page.pageIndex]));
  const images = packs
    .flatMap((pack) => pack.images)
    .map((image) =>
      image.locator.kind === 'page'
        ? {
            ...image,
            locator: {
              ...image.locator,
              pageIndex:
                pageIndexes.get(image.locator.pageId) ??
                image.locator.pageIndex,
            },
          }
        : image,
    );

  return {
    sourceVersionId: versionId,
    parseRunId: jobId,
    rawOutputAssetId: packs[0]!.rawOutputAssetId,
    pages,
    regions: packs.flatMap((pack) => pack.regions),
    images,
    warnings: packs.flatMap((pack) => pack.warnings),
  };
}
