import { failure } from '../failure.js';

import type {
  ClockPort,
  DurableSourceParsingPort,
  JobStep,
  OperationResult,
  ParsedSourcePack,
  SourceParsingHandle,
  TransactionPort,
} from '../../../ports/index.js';

/** a successful provider response to save with its previous step revision */
export interface ParseProgressParams {
  readonly transaction: TransactionPort;
  readonly clock: ClockPort;
  readonly ownerId: string;
  readonly jobId: string;
  readonly step: JobStep | null;
  readonly stepName: string;
  readonly handle: SourceParsingHandle | null;
  readonly progress: Extract<
    Awaited<ReturnType<DurableSourceParsingPort['submit']>>,
    { readonly success: true }
  >;
}

/**
 * commits the raw provider checkpoint, job state and initial provider association
 * @param params provider progress and expected checkpoint revision
 * @returns CAS outcome from the same owner-scoped progress transaction
 */
export async function saveParseProgress(
  params: ParseProgressParams,
): Promise<OperationResult<void>> {
  const {
    transaction,
    clock,
    ownerId,
    jobId,
    step,
    stepName,
    handle,
    progress,
  } = params;
  const nextStep = createParseStep(params);

  return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
    if (!(await unit.jobs.updateStep(nextStep, step?.revision ?? 0))) {
      return failure(
        'REVISION_CONFLICT',
        'Source parse step changed concurrently',
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
            stage: 'parsing',
            resumeAfter: progress.data.resumeAfter,
          }
        : { kind: 'running' as const, stage: 'parsing' };
    if (
      !(await unit.jobs.update(
        { ...job, state, updatedAt: clock.now() },
        job.updatedAt,
      ))
    ) {
      return failure(
        'REVISION_CONFLICT',
        'Source job changed during checkpoint',
      );
    }
    if (progress.data.kind === 'waiting' && !handle) {
      await unit.jobs.mapProviderJob(
        progress.data.provider,
        progress.data.providerJobId,
        jobId,
        stepName,
      );
    }

    return { success: true, data: undefined };
  });
}

/**
 * validates a saved provider parsing handle before resuming it
 * @param value unknown persisted checkpoint
 * @returns whether every required handle identity field is present
 */
export function isParsingHandle(value: unknown): value is SourceParsingHandle {
  return (
    value !== null &&
    typeof value === 'object' &&
    'sourceVersionId' in value &&
    'parseRunId' in value &&
    'originalAssetId' in value &&
    'provider' in value &&
    'providerJobId' in value &&
    typeof value.sourceVersionId === 'string' &&
    typeof value.parseRunId === 'string' &&
    typeof value.originalAssetId === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.providerJobId === 'string'
  );
}

/**
 * validates a saved aggregate or original-asset parsed result
 * @param value unknown persisted step result
 * @returns whether canonical pack collections and raw output identity are present
 */
export function isParsedSourcePack(value: unknown): value is ParsedSourcePack {
  return (
    value !== null &&
    typeof value === 'object' &&
    'pages' in value &&
    Array.isArray(value.pages) &&
    'regions' in value &&
    Array.isArray(value.regions) &&
    'images' in value &&
    Array.isArray(value.images) &&
    'rawOutputAssetId' in value &&
    typeof value.rawOutputAssetId === 'string'
  );
}

/**
 * retains the provider's raw waiting handle or completed pack in the job step
 * @param params provider response and previous checkpoint revision
 * @returns the exact next persisted parse step
 */
function createParseStep(params: ParseProgressParams): JobStep {
  const { jobId, stepName, step, progress } = params;

  return {
    jobId,
    step: stepName,
    revision: (step?.revision ?? 0) + 1,
    state: progress.data.kind === 'waiting' ? 'waiting' : 'completed',
    leaseUntil:
      progress.data.kind === 'waiting'
        ? (progress.data.resumeAfter ?? null)
        : null,
    checkpoint:
      progress.data.kind === 'waiting'
        ? {
            sourceVersionId: progress.data.sourceVersionId,
            parseRunId: progress.data.parseRunId,
            originalAssetId: progress.data.originalAssetId,
            provider: progress.data.provider,
            providerJobId: progress.data.providerJobId,
          }
        : null,
    result: progress.data.kind === 'completed' ? progress.data.pack : null,
  };
}
