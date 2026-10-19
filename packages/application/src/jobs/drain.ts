import type { JobKind } from '@antica/contracts';

import type {
  ClockPort,
  JobStep,
  OperationResult,
  OutboxMessage,
  TransactionPort,
} from '../ports/index.js';

/** reports whether a durable handler completed or paused its run */
export interface JobHandlerOutcome {
  readonly settled: boolean;
}

export type JobHandler = (
  ownerId: string,
  jobId: string,
) => Promise<OperationResult<void | JobHandlerOutcome>>;
export type JobHandlers = Partial<Readonly<Record<JobKind, JobHandler>>>;

export interface OutboxDrainParams {
  readonly listPending: (limit: number) => Promise<readonly OutboxMessage[]>;
  readonly transaction: TransactionPort;
  readonly handlers: JobHandlers;
  readonly clock: ClockPort;
}

export interface DrainReport {
  readonly inspected: number;
  readonly settled: number;
  readonly deferred: number;
  readonly failures: ReadonlyArray<{
    readonly jobId: string;
    readonly code: string;
  }>;
}

/**
 * creates a resumable dispatcher for persisted outbox jobs
 * @param params supplies pending messages, transactional job state, handlers, and time
 * @returns drain function that inspects up to the requested limit (default 100) and reports settled, deferred, and failed jobs
 */
export function createOutboxDrain(
  params: OutboxDrainParams,
): (limit?: number) => Promise<DrainReport> {
  return async (limit = 100) => {
    const messages = await params.listPending(limit);
    let settled = 0;
    let deferred = 0;
    const failures: Array<{ jobId: string; code: string }> = [];
    for (const message of messages) {
      const outcome = await dispatchMessage(params, message);
      if (outcome.settled) {
        settled += 1;
      } else {
        deferred += 1;
      }
      failures.push(
        ...outcome.failures.map((code) => ({
          jobId: message.event.jobId,
          code,
        })),
      );
    }

    return { inspected: messages.length, settled, deferred, failures };
  };
}

interface DispatchOutcome {
  readonly settled: boolean;
  readonly failures: readonly string[];
}

/**
 * dispatches one durable message while preserving per-job error reporting
 * @param params durable job capabilities
 * @param message one persisted delivery
 * @returns terminal status and failure codes for this job
 */
async function dispatchMessage(
  params: OutboxDrainParams,
  message: OutboxMessage,
): Promise<DispatchOutcome> {
  if (
    message.name === 'antica/knowledgeImport.requested' &&
    params.handlers.knowledgeImport
  ) {
    // the portable import handler owns its measured lease, checkpoint and next event
    const result = await invokeHandler(
      params.handlers.knowledgeImport,
      message,
    );

    return {
      settled: result.success && result.data?.settled !== false,
      failures: result.success ? [] : [result.error.code],
    };
  }
  const claimed = await claim(params, message);
  if (!claimed.success) {
    return { settled: false, failures: [claimed.error.code] };
  }
  if (claimed.data.kind !== 'claimed') {
    return { settled: claimed.data.kind === 'settled', failures: [] };
  }
  const result = await invokeHandler(
    params.handlers[claimed.data.jobKind],
    message,
  );
  const completed = await settle(
    params,
    message,
    claimed.data.stepRevision,
    result,
  );

  return {
    settled: completed.success && completed.data,
    failures: [
      ...(!completed.success ? [completed.error.code] : []),
      ...(!result.success ? [result.error.code] : []),
    ],
  };
}

type Claim =
  | { readonly kind: 'settled' }
  | { readonly kind: 'leased' }
  | {
      readonly kind: 'claimed';
      readonly jobKind: JobKind;
      readonly stepRevision: number;
    };

/**
 * @param params
 * @param message
 */
async function claim(
  params: OutboxDrainParams,
  message: OutboxMessage,
): Promise<OperationResult<Claim>> {
  return params.transaction.run<OperationResult<Claim>>(
    message.event.ownerId,
    async (unit) => {
      const job = await unit.jobs.get(message.event.jobId);
      if (!job || job.resourceId !== message.event.resourceId) {
        return failure('NOT_FOUND', 'Outbox job not found');
      }
      if (isTerminal(job.state.kind)) {
        await unit.outbox.markSent(message.id, params.clock.now());

        return { success: true, data: { kind: 'settled' } };
      }
      const prior = await unit.jobs.getStep(job.id, 'dispatch');
      const now = params.clock.now();
      if (
        prior?.state === 'leased' &&
        prior.leaseUntil &&
        Date.parse(prior.leaseUntil) > Date.parse(now)
      ) {
        return { success: true, data: { kind: 'leased' } };
      }
      const lease: JobStep = {
        jobId: job.id,
        step: 'dispatch',
        revision: (prior?.revision ?? 0) + 1,
        state: 'leased',
        leaseUntil: new Date(Date.parse(now) + 60 * 60_000).toISOString(),
        checkpoint: message.id,
        result: prior?.result ?? null,
      };
      if (!(await unit.jobs.updateStep(lease, prior?.revision ?? 0))) {
        return failure('REVISION_CONFLICT', 'Job was claimed concurrently');
      }

      return {
        success: true,
        data: {
          kind: 'claimed',
          jobKind: job.kind,
          stepRevision: lease.revision,
        },
      };
    },
  );
}

/**
 * @param params
 * @param message
 * @param stepRevision
 * @param result
 */
async function settle(
  params: OutboxDrainParams,
  message: OutboxMessage,
  stepRevision: number,
  result: Awaited<ReturnType<JobHandler>>,
): Promise<OperationResult<boolean>> {
  return params.transaction.run<OperationResult<boolean>>(
    message.event.ownerId,
    async (unit) => {
      const job = await unit.jobs.get(message.event.jobId);
      const step = await unit.jobs.getStep(message.event.jobId, 'dispatch');
      if (!job || !step) {
        return failure('NOT_FOUND', 'Job disappeared during dispatch');
      }
      if (step.revision !== stepRevision) {
        return failure('REVISION_CONFLICT', 'Job dispatch lease changed');
      }
      let terminal = isTerminal(job.state.kind);
      if (!result.success && !terminal) {
        const now = params.clock.now();
        const next = result.error.retryable
          ? { kind: 'waiting' as const, stage: 'retry' }
          : {
              kind: 'failed' as const,
              error: { ...result.error, requestId: message.event.eventId },
            };
        if (
          !(await unit.jobs.update(
            {
              ...job,
              state: next,
              updatedAt: nextTimestamp(now, job.updatedAt),
            },
            job.updatedAt,
          ))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Job changed during failure save',
          );
        }
        terminal = !result.error.retryable;
      }
      const nextStep: JobStep = {
        ...step,
        revision: step.revision + 1,
        state: terminal
          ? job.state.kind === 'failed' || !result.success
            ? 'failed'
            : 'completed'
          : 'waiting',
        leaseUntil: null,
        result: result.success ? null : { errorCode: result.error.code },
      };
      if (!(await unit.jobs.updateStep(nextStep, step.revision))) {
        return failure('REVISION_CONFLICT', 'Job dispatch step changed');
      }
      if (terminal) {
        await unit.outbox.markSent(message.id, params.clock.now());
      }

      return { success: true, data: terminal };
    },
  );
}

/**
 * @param now
 * @param previous
 */
function nextTimestamp(now: string, previous: string): string {
  return new Date(
    Math.max(Date.parse(now), Date.parse(previous) + 1),
  ).toISOString();
}

/** @param kind */
function isTerminal(kind: string): boolean {
  return kind === 'succeeded' || kind === 'partial' || kind === 'failed';
}

/**
 * @param code
 * @param message
 */
function failure(
  code: 'NOT_FOUND' | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}

/**
 * contains one handler failure so unrelated queued jobs can still run
 * @param handler configured job-specific workload
 * @param message durable outbox delivery
 * @returns handler outcome or a retryable failure
 */
async function invokeHandler(
  handler: JobHandler | undefined,
  message: OutboxMessage,
): ReturnType<JobHandler> {
  try {
    return handler
      ? await handler(message.event.ownerId, message.event.jobId)
      : {
          success: false,
          error: {
            code: 'JOB_FAILED',
            message: 'No handler configured',
            retryable: false,
          },
        };
  } catch {
    return {
      success: false,
      error: {
        code: 'JOB_FAILED',
        message: 'Job handler failed unexpectedly',
        retryable: true,
      },
    };
  }
}
