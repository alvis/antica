import { failure } from './failure.js';

import type { JobEnvelope } from '@antica/contracts';
import type { SourceVersion } from '@antica/domain';

import type {
  ClockPort,
  JobStep,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../../ports/index.js';
import type { SourcePageRunSelection } from '../../ports/storage.js';

/** immutable selected-page projection captured before activating a parse run */
export interface SourceParseBase {
  readonly pages: readonly SourcePageRunSelection[];
  readonly textIndexStatus: SourceVersion['textIndexStatus'];
  readonly imageIndexStatus: SourceVersion['imageIndexStatus'];
}

/** state returned from the existing preparation transaction */
export interface PreparedSource {
  readonly version: SourceVersion;
  readonly pageIds: readonly string[] | undefined;
  readonly base: SourceParseBase | null;
  readonly done: boolean;
}

/** inputs for owner-scoped source job preparation */
export interface PrepareSourceParams {
  readonly transaction: TransactionPort;
  readonly clock: ClockPort;
  readonly ownerId: string;
  readonly jobId: string;
}

interface PreparationRead extends Omit<PreparedSource, 'done'> {
  readonly job: JobEnvelope;
  readonly baseStep: JobStep | null;
}

interface CaptureBaseParams {
  readonly unit: UnitOfWork;
  readonly job: JobEnvelope;
  readonly version: SourceVersion;
  readonly pageIds: readonly string[] | undefined;
}

interface ActivateParams {
  readonly unit: UnitOfWork;
  readonly read: PreparationRead;
  readonly clock: ClockPort;
  readonly jobId: string;
}

/**
 * prepares a source job and captures the selected-page base in one transaction
 * @param params collector-scoped transaction, clock and job identity
 * @returns processing state, completed replay, or a precise CAS failure
 */
export async function prepareSourceIngestion(
  params: PrepareSourceParams,
): Promise<OperationResult<PreparedSource>> {
  const { transaction, clock, ownerId, jobId } = params;

  return transaction.run<OperationResult<PreparedSource>>(
    ownerId,
    async (unit) => {
      const loaded = await readPreparation(unit, jobId);
      if (!loaded.success) {
        return loaded;
      }
      const read = loaded.data;
      if (
        read.job.state.kind === 'succeeded' ||
        read.job.state.kind === 'partial'
      ) {
        return {
          success: true,
          data: {
            version: read.version,
            pageIds: read.pageIds,
            base: read.base,
            done: true,
          },
        };
      }
      if (read.baseStep && read.version.activeParseRunId !== jobId) {
        return failure(
          'REVISION_CONFLICT',
          'A newer source parse superseded this job',
        );
      }

      return activateProcessing({ unit, read, clock, jobId });
    },
  );
}

/**
 * reads authorized job state and the saved or new projection base
 * @param unit current owner-scoped transaction
 * @param jobId source ingestion job identifier
 * @returns job, version and immutable base, or a read/CAS failure
 */
async function readPreparation(
  unit: UnitOfWork,
  jobId: string,
): Promise<OperationResult<PreparationRead>> {
  const job = await unit.jobs.get(jobId);
  if (job?.kind !== 'sourceIngestion') {
    return failure('NOT_FOUND', 'Source job not found');
  }
  const version = await unit.sources.getVersion(job.resourceId);
  if (!version) {
    return failure('NOT_FOUND', 'Source version not found');
  }
  const source = await unit.sources.get(version.sourceId, version.id);
  if (!source) {
    return failure('NOT_FOUND', 'Source not found');
  }
  const pageIds =
    job.result &&
    typeof job.result === 'object' &&
    'pageIds' in job.result &&
    Array.isArray(job.result.pageIds)
      ? job.result.pageIds.filter((id): id is string => typeof id === 'string')
      : undefined;
  const captured = await captureBase({ unit, job, version, pageIds });
  if (!captured.success) {
    return captured;
  }

  return { success: true, data: { job, version, pageIds, ...captured.data } };
}

/**
 * captures the prior page-to-run projection before the active run changes
 * @param params existing transaction and selected-page state
 * @returns saved or newly read base and its checkpoint revision
 */
async function captureBase(params: CaptureBaseParams): Promise<
  OperationResult<{
    readonly baseStep: JobStep | null;
    readonly base: SourceParseBase | null;
  }>
> {
  const { unit, job, version, pageIds } = params;
  if (
    pageIds &&
    !(await unit.sources.updateVersion(
      version,
      version.status,
      version.activeParseRunId,
    ))
  ) {
    return failure(
      'REVISION_CONFLICT',
      'Source version changed before projection capture',
    );
  }
  const baseStep = pageIds
    ? await unit.jobs.getStep(job.id, 'parse:base')
    : null;
  if (baseStep && !isSourceParseBase(baseStep.result)) {
    return failure(
      'SOURCE_UNAVAILABLE',
      'Saved source projection is unavailable',
    );
  }
  const base = pageIds
    ? baseStep
      ? (baseStep.result as SourceParseBase)
      : {
          pages: await unit.sources.getPageRunSelection(version.id),
          textIndexStatus: version.textIndexStatus,
          imageIndexStatus: version.imageIndexStatus,
        }
    : null;

  return { success: true, data: { baseStep, base } };
}

/**
 * activates the parse run after staging its base checkpoint in the same transaction
 * the checkpoint, version and job transitions commit or roll back together
 * @param params existing UnitOfWork, captured base and clock
 * @returns active processing state or the original checkpoint/version/job conflict
 */
async function activateProcessing(
  params: ActivateParams,
): Promise<OperationResult<PreparedSource>> {
  const { unit, read, clock, jobId } = params;
  const { job, version, pageIds, base, baseStep } = read;
  if (pageIds && !baseStep) {
    const step: JobStep = {
      jobId,
      step: 'parse:base',
      revision: 1,
      state: 'completed',
      leaseUntil: null,
      checkpoint: null,
      result: base,
    };
    if (!(await unit.jobs.updateStep(step, 0))) {
      return failure(
        'REVISION_CONFLICT',
        'Source projection changed during processing',
      );
    }
  }
  const now = clock.now();
  const processing: SourceVersion = {
    ...version,
    status: 'processing',
    textIndexStatus: 'processing',
    imageIndexStatus: 'processing',
    activeParseRunId: jobId,
  };
  if (
    !(await unit.sources.updateVersion(
      processing,
      version.status,
      version.activeParseRunId,
    ))
  ) {
    return failure(
      'REVISION_CONFLICT',
      'Source version changed during processing',
    );
  }
  const started = await unit.jobs.update(
    { ...job, state: { kind: 'running', stage: 'parsing' }, updatedAt: now },
    job.updatedAt,
  );
  if (!started) {
    return failure('REVISION_CONFLICT', 'Source job changed during processing');
  }

  return {
    success: true,
    data: { version: processing, pageIds, base, done: false },
  };
}

/**
 * validates an unknown persisted selected-page base before retry or replay
 * @param value saved job step result at the persistence trust boundary
 * @returns whether page-to-run identities and pre-processing statuses are present
 */
function isSourceParseBase(value: unknown): value is SourceParseBase {
  return (
    value !== null &&
    typeof value === 'object' &&
    'pages' in value &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (page: unknown) =>
        page !== null &&
        typeof page === 'object' &&
        'pageId' in page &&
        typeof page.pageId === 'string' &&
        'parseRunId' in page &&
        (typeof page.parseRunId === 'string' || page.parseRunId === null),
    ) &&
    'textIndexStatus' in value &&
    typeof value.textIndexStatus === 'string' &&
    'imageIndexStatus' in value &&
    typeof value.imageIndexStatus === 'string'
  );
}
