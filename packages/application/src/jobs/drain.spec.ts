import { describe, expect, it, vi } from 'vitest';

import { createOutboxDrain } from './drain.js';

import type { JobEnvelope } from '@antica/contracts';

import type {
  JobStep,
  OperationResult,
  OutboxMessage,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { JobHandlers } from './drain.js';

const now = '2026-10-13T12:00:00.000Z';
const job: JobEnvelope = {
  id: 'job-1',
  kind: 'analysis',
  resourceId: 'record-1',
  state: { kind: 'queued' },
  createdAt: now,
  updatedAt: now,
  result: null,
};
const message: OutboxMessage = {
  id: 'outbox-1',
  name: 'antica.analysis.requested',
  createdAt: now,
  sentAt: null,
  event: {
    eventId: 'event-1',
    schemaVersion: '1',
    jobId: job.id,
    resourceId: job.resourceId,
    ownerId: 'collector-1',
    idempotencyKey: 'key-1',
  },
};
const success: OperationResult<void> = { success: true, data: undefined };
const retryable: OperationResult<void> = {
  success: false,
  error: {
    code: 'JOB_FAILED',
    message: 'Provider unavailable',
    retryable: true,
  },
};

function fixture(
  options: {
    readonly job?: JobEnvelope | null;
    readonly step?: JobStep | null;
    readonly claim?: boolean;
    readonly update?: boolean;
    readonly settle?: boolean;
    readonly messages?: readonly OutboxMessage[];
    readonly handlers?: JobHandlers;
  } = {},
) {
  const current: { job: JobEnvelope | null; step: JobStep | null } = {
    job: 'job' in options ? (options.job ?? null) : job,
    step: options.step ?? null,
  };
  const sent: string[] = [];
  const owners: string[] = [];
  const limits: number[] = [];
  const update = vi.fn(async (next: JobEnvelope, _expected: string) => {
    if (options.update === false) {
      return false;
    }
    current.job = next;

    return true;
  });
  const updateStep = vi.fn(async (next: JobStep, _expected: number) => {
    if (next.state === 'leased' && options.claim === false) {
      return false;
    }
    if (next.state !== 'leased' && options.settle === false) {
      return false;
    }
    current.step = next;

    return true;
  });
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      ownerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      owners.push(ownerId);
      const repositories = {
        jobs: {
          get: async () => current.job,
          getStep: async () => current.step,
          update,
          updateStep,
        },
        outbox: {
          markSent: async (id: string) => {
            sent.push(id);
          },
        },
      };

      return operation(
        new Proxy({} as UnitOfWork, {
          get: (_target, key) =>
            key in repositories ? Reflect.get(repositories, key) : undefined,
        }),
      );
    },
  };
  const drain = createOutboxDrain({
    listPending: async (limit) => {
      limits.push(limit);

      return options.messages ?? [message];
    },
    transaction,
    handlers: options.handlers ?? {},
    clock: { now: () => now },
  });

  return { drain, current, sent, owners, limits, update, updateStep };
}

describe('fn:createOutboxDrain', () => {
  it('should leave a missing job unsent and report its persistent lookup failure', async () => {
    const ports = fixture({ job: null });

    expect(await ports.drain(3)).toEqual({
      inspected: 1,
      settled: 0,
      deferred: 1,
      failures: [{ jobId: job.id, code: 'NOT_FOUND' }],
    });
    expect(ports.sent).toEqual([]);
    expect(ports.owners).toEqual([message.event.ownerId]);
    expect(ports.limits).toEqual([3]);
  });

  it('should settle an already completed job without dispatching it again', async () => {
    const handler = vi.fn(async () => success);
    const ports = fixture({
      job: { ...job, state: { kind: 'succeeded', completedAt: now } },
      handlers: { analysis: handler },
    });

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 1,
      deferred: 0,
      failures: [],
    });
    expect(ports.sent).toEqual([message.id]);
    expect(handler).not.toHaveBeenCalled();
    expect(ports.limits).toEqual([100]);
  });

  it('should defer a live lease without dispatching or marking its message sent', async () => {
    const handler = vi.fn(async () => success);
    const ports = fixture({
      step: {
        jobId: job.id,
        step: 'dispatch',
        revision: 2,
        state: 'leased',
        leaseUntil: '2026-10-13T12:30:00.000Z',
        checkpoint: message.id,
        result: null,
      },
      handlers: { analysis: handler },
    });

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 0,
      deferred: 1,
      failures: [],
    });
    expect(ports.sent).toEqual([]);
    expect(handler).not.toHaveBeenCalled();
  });

  it('should reclaim an expired lease and settle a job completed by its handler', async () => {
    const ports = fixture({
      step: {
        jobId: job.id,
        step: 'dispatch',
        revision: 2,
        state: 'leased',
        leaseUntil: '2026-10-13T11:30:00.000Z',
        checkpoint: null,
        result: null,
      },
      handlers: {
        analysis: async () => {
          ports.current.job = {
            ...job,
            state: { kind: 'succeeded', completedAt: now },
          };

          return success;
        },
      },
    });

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 1,
      deferred: 0,
      failures: [],
    });
    expect(ports.current.step).toMatchObject({
      revision: 4,
      state: 'completed',
      leaseUntil: null,
    });
    expect(ports.sent).toEqual([message.id]);
  });

  it('should fail an unhandled job durably and send its terminal message', async () => {
    const ports = fixture();

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 1,
      deferred: 0,
      failures: [{ jobId: job.id, code: 'JOB_FAILED' }],
    });
    expect(ports.current.job?.state.kind).toBe('failed');
    expect(ports.current.step).toMatchObject({
      state: 'failed',
      result: { errorCode: 'JOB_FAILED' },
    });
    expect(ports.sent).toEqual([message.id]);
  });

  it('should retain a thrown handler failure for retry', async () => {
    const ports = fixture({
      handlers: {
        analysis: async () => {
          throw new Error('network');
        },
      },
    });

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 0,
      deferred: 1,
      failures: [{ jobId: job.id, code: 'JOB_FAILED' }],
    });
    expect(ports.current.job?.state).toEqual({
      kind: 'waiting',
      stage: 'retry',
    });
    expect(ports.current.step?.state).toBe('waiting');
    expect(ports.sent).toEqual([]);
  });

  it('should preserve retryability and advance a stale timestamp on handler failure', async () => {
    const ports = fixture({
      job: { ...job, updatedAt: '2026-10-13T12:00:01.000Z' },
      handlers: { analysis: async () => retryable },
    });

    expect(await ports.drain()).toMatchObject({
      inspected: 1,
      settled: 0,
      deferred: 1,
    });
    expect(ports.current.job?.updatedAt).toBe('2026-10-13T12:00:01.001Z');
    expect(ports.current.job?.state).toEqual({
      kind: 'waiting',
      stage: 'retry',
    });
  });

  it('should report an outbox resource mismatch before claiming the job', async () => {
    const ports = fixture({ job: { ...job, resourceId: 'another-record' } });

    expect(await ports.drain()).toMatchObject({
      deferred: 1,
      failures: [{ jobId: job.id, code: 'NOT_FOUND' }],
    });
    expect(ports.updateStep).not.toHaveBeenCalled();
  });

  it('should report a concurrent claim without invoking a handler', async () => {
    const handler = vi.fn(async () => success);
    const ports = fixture({ claim: false, handlers: { analysis: handler } });

    expect(await ports.drain()).toMatchObject({
      deferred: 1,
      failures: [{ jobId: job.id, code: 'REVISION_CONFLICT' }],
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should report a lost completion step after a successful handler', async () => {
    const ports = fixture({
      settle: false,
      handlers: { analysis: async () => success },
    });

    expect(await ports.drain()).toMatchObject({
      deferred: 1,
      failures: [{ jobId: job.id, code: 'REVISION_CONFLICT' }],
    });
    expect(ports.sent).toEqual([]);
  });

  it('should report a job removed while its handler was running', async () => {
    const ports = fixture({
      handlers: {
        analysis: async () => {
          ports.current.job = null;

          return success;
        },
      },
    });

    expect(await ports.drain()).toMatchObject({
      deferred: 1,
      failures: [{ jobId: job.id, code: 'NOT_FOUND' }],
    });
    expect(ports.sent).toEqual([]);
  });

  it('should report a dispatch lease replaced while its handler was running', async () => {
    const ports = fixture({
      handlers: {
        analysis: async () => {
          if (ports.current.step) {
            ports.current.step = {
              ...ports.current.step,
              revision: ports.current.step.revision + 1,
            };
          }

          return success;
        },
      },
    });

    expect(await ports.drain()).toMatchObject({
      deferred: 1,
      failures: [{ jobId: job.id, code: 'REVISION_CONFLICT' }],
    });
    expect(ports.sent).toEqual([]);
  });

  it('should report a failed job state comparison without sending its message', async () => {
    const ports = fixture({ update: false });

    expect(await ports.drain()).toEqual({
      inspected: 1,
      settled: 0,
      deferred: 1,
      failures: [
        { jobId: job.id, code: 'REVISION_CONFLICT' },
        { jobId: job.id, code: 'JOB_FAILED' },
      ],
    });
    expect(ports.sent).toEqual([]);
  });
});
