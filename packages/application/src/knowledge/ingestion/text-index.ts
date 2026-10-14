import { stableCitationId } from './citation.js';

import { failure } from './failure.js';

import type {
  CanonicalTextChunk,
  ClockPort,
  DurableTextIndexWriterPort,
  IndexIdentity,
  JobStep,
  OperationResult,
  ParsedSourcePack,
  ProviderChunkMapping,
  TextIndexHandle,
  TransactionPort,
} from '../../ports/index.js';

import type { SourceIndexingParams } from '../ingestion.js';

/** local count or captured external identity and provider mappings */
export type TextIndexOutcome =
  | { readonly kind: 'local'; readonly indexedCount: number }
  | {
      readonly kind: 'external';
      readonly indexedCount: number;
      readonly index: IndexIdentity;
      readonly mappings: readonly ProviderChunkMapping[];
    };

/** inputs for the selected text indexing stage */
export interface TextIndexStageParams {
  readonly transaction: TransactionPort;
  readonly config: SourceIndexingParams['text'];
  readonly ownerId: string;
  readonly jobId: string;
  readonly pack: ParsedSourcePack;
  readonly clock: ClockPort;
}

type ExternalTextIndexParams = Omit<TextIndexStageParams, 'config'> & {
  readonly config: Extract<
    SourceIndexingParams['text'],
    { readonly kind: 'external' }
  >;
};

interface DurableIndexParams extends ExternalTextIndexParams {
  readonly writer: DurableTextIndexWriterPort;
  readonly chunks: readonly CanonicalTextChunk[];
}

interface SaveIndexParams extends DurableIndexParams {
  readonly step: JobStep | null;
  readonly handle: TextIndexHandle | null;
  readonly nextStep: JobStep;
  readonly progress: Extract<
    Awaited<ReturnType<DurableTextIndexWriterPort['submit']>>,
    { readonly success: true }
  >;
}

/**
 * selects a count-only local outcome or an externally persisted text result
 * @param params parsed pages, writer configuration and owner-scoped checkpoint port
 * @returns local count or captured external mappings, or null while pending
 */
export async function selectTextIndexOutcome(
  params: TextIndexStageParams,
): Promise<OperationResult<TextIndexOutcome | null>> {
  const { config, pack } = params;
  if (config.kind === 'local') {
    return {
      success: true,
      data: {
        kind: 'local',
        indexedCount: pack.pages.filter((page) => page.rawText.trim()).length,
      },
    };
  }

  const index: IndexIdentity = { ...config.index };
  const indexed = await indexText({
    ...params,
    config: { ...config, index: { ...index } },
  });
  if (!indexed.success) {
    return indexed;
  }
  if (!indexed.data) {
    return { success: true, data: null };
  }

  return {
    success: true,
    data: {
      kind: 'external',
      index,
      indexedCount: indexed.data.indexedCount,
      mappings: indexed.data.mappings,
    },
  };
}

/**
 * indexes canonical text directly or resumes its durable checkpoint
 * @param params captured external index, writer, job, pages and clock
 * @returns raw writer count and mappings, or null while pending
 */
async function indexText(params: ExternalTextIndexParams): Promise<
  OperationResult<{
    readonly indexedCount: number;
    readonly mappings: readonly ProviderChunkMapping[];
  } | null>
> {
  const { transaction, config, ownerId, jobId, pack, clock } = params;
  const chunks: CanonicalTextChunk[] = pack.pages
    .filter((page) => page.rawText.trim())
    .map((page) => ({
      sourceVersionId: pack.sourceVersionId,
      parseRunId: pack.parseRunId,
      citationId: stableCitationId(page.id),
      canonicalRegionIds: page.regionIds,
      contentAsRetrieved: page.rawText,
    }));
  if ('indexSource' in config.writer) {
    const indexed = await config.writer.indexSource({
      index: config.index,
      sourceVersionId: pack.sourceVersionId,
      chunks,
    });

    return indexed.success ? { success: true, data: indexed.data } : indexed;
  }

  return indexDurably({
    transaction,
    config,
    ownerId,
    jobId,
    pack,
    clock,
    writer: config.writer,
    chunks,
  });
}

/**
 * reads the raw index step, invokes the durable writer outside SQL and saves its progress
 * @param params external writer and canonical chunks for one source run
 * @returns completed writer data, or null while the provider is pending
 */
async function indexDurably(params: DurableIndexParams): Promise<
  OperationResult<{
    readonly indexedCount: number;
    readonly mappings: readonly ProviderChunkMapping[];
  } | null>
> {
  const { transaction, ownerId, jobId, pack, writer, config, chunks } = params;
  const current = await transaction.run<OperationResult<JobStep | null>>(
    ownerId,
    async (unit) => ({
      success: true,
      data: await unit.jobs.getStep(jobId, 'index:text'),
    }),
  );
  if (!current.success) {
    return current;
  }
  const step = current.data;
  if (step?.state === 'completed' && isTextIndexResult(step.result)) {
    return { success: true, data: step.result };
  }
  const handle =
    step?.state === 'waiting' && isTextIndexHandle(step.checkpoint)
      ? step.checkpoint
      : null;
  const progress = handle
    ? await writer.resume(handle)
    : await writer.submit({
        index: config.index,
        sourceVersionId: pack.sourceVersionId,
        parseRunId: pack.parseRunId,
        chunks,
      });
  if (!progress.success) {
    return progress;
  }
  const nextStep = createIndexStep({ jobId, step, progress });

  const saved = await saveIndexProgress({
    ...params,
    step,
    handle,
    progress,
    nextStep,
  });
  if (!saved.success) {
    return saved;
  }

  return progress.data.kind === 'waiting'
    ? { success: true, data: null }
    : { success: true, data: progress.data };
}

/**
 * retains the writer's raw waiting or completed result in the job step
 * @param params current step revision and successful provider progress
 * @returns the next durable text index step
 */
function createIndexStep(
  params: Pick<SaveIndexParams, 'jobId' | 'step' | 'progress'>,
): JobStep {
  const { jobId, step, progress } = params;

  return {
    jobId,
    step: 'index:text',
    revision: (step?.revision ?? 0) + 1,
    state: progress.data.kind === 'waiting' ? 'waiting' : 'completed',
    leaseUntil:
      progress.data.kind === 'waiting'
        ? (progress.data.resumeAfter ?? null)
        : null,
    checkpoint: progress.data.kind === 'waiting' ? progress.data : null,
    result: progress.data.kind === 'completed' ? progress.data : null,
  };
}

/**
 * saves the exact provider checkpoint and job transition in one transaction
 * @param params provider progress with expected step and job revisions
 * @returns CAS result from the owner-scoped transaction
 */
async function saveIndexProgress(
  params: SaveIndexParams,
): Promise<OperationResult<void>> {
  const {
    transaction,
    ownerId,
    jobId,
    clock,
    step,
    handle,
    progress,
    nextStep,
  } = params;

  return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
    if (!(await unit.jobs.updateStep(nextStep, step?.revision ?? 0))) {
      return failure(
        'REVISION_CONFLICT',
        'Text index step changed concurrently',
      );
    }
    const job = await unit.jobs.get(jobId);
    if (!job) {
      return failure('NOT_FOUND', 'Source job not found');
    }
    const state =
      progress.data.kind === 'waiting'
        ? {
            kind: 'waiting' as const,
            stage: 'text_index',
            resumeAfter: progress.data.resumeAfter,
          }
        : { kind: 'running' as const, stage: 'image_index' };
    if (
      !(await unit.jobs.update(
        { ...job, state, updatedAt: clock.now() },
        job.updatedAt,
      ))
    ) {
      return failure(
        'REVISION_CONFLICT',
        'Source job changed during text index checkpoint',
      );
    }
    if (
      progress.data.kind === 'waiting' &&
      progress.data.providerJobId &&
      !handle
    ) {
      await unit.jobs.mapProviderJob(
        progress.data.provider,
        progress.data.providerJobId,
        jobId,
        'index:text',
      );
    }

    return { success: true, data: undefined };
  });
}

/**
 * validates an unknown saved durable index handle
 * @param value persisted checkpoint candidate
 * @returns whether required writer and index fields are present
 */
function isTextIndexHandle(value: unknown): value is TextIndexHandle {
  return (
    value !== null &&
    typeof value === 'object' &&
    'sourceVersionId' in value &&
    typeof value.sourceVersionId === 'string' &&
    'parseRunId' in value &&
    typeof value.parseRunId === 'string' &&
    'provider' in value &&
    typeof value.provider === 'string' &&
    'providerDocumentIds' in value &&
    Array.isArray(value.providerDocumentIds) &&
    'checkpointAssetId' in value &&
    typeof value.checkpointAssetId === 'string' &&
    'index' in value &&
    value.index !== null &&
    typeof value.index === 'object'
  );
}

/**
 * validates a completed writer result retained in a job step
 * @param value unknown persisted result candidate
 * @returns whether count and mappings are present
 */
function isTextIndexResult(value: unknown): value is {
  readonly indexedCount: number;
  readonly mappings: readonly ProviderChunkMapping[];
} {
  return (
    value !== null &&
    typeof value === 'object' &&
    'indexedCount' in value &&
    typeof value.indexedCount === 'number' &&
    'mappings' in value &&
    Array.isArray(value.mappings)
  );
}
