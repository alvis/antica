import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  CommandRepository,
  JobRepository,
  OutboxMessage,
  OutboxRepository,
} from '@antica/application/ports';
import type { JobEnvelope, JobState } from '@antica/contracts';
import type { Transaction } from '../transaction.js';
import type { Database } from '../connection.js';
import {
  idempotencyRequests,
  jobSteps,
  jobs,
  outbox,
  providerEvents,
  providerJobMappings,
} from '../schema/index.js';

function toJob(row: typeof jobs.$inferSelect): JobEnvelope {
  const state: JobState =
    row.state === 'running'
      ? { kind: 'running', stage: row.stage }
      : row.state === 'waiting'
        ? { kind: 'waiting', stage: row.stage }
        : row.state === 'succeeded'
          ? {
              kind: 'succeeded',
              completedAt: new Date(row.completedAt!).toISOString(),
            }
          : row.state === 'partial'
            ? {
                kind: 'partial',
                completedAt: new Date(row.completedAt!).toISOString(),
                incompleteStages:
                  (row.result as { incompleteStages?: string[] } | null)
                    ?.incompleteStages ?? [],
              }
            : row.state === 'failed'
              ? {
                  kind: 'failed',
                  error: row.error as Extract<
                    JobState,
                    { kind: 'failed' }
                  >['error'],
                }
              : { kind: 'queued' };
  return {
    id: row.id,
    kind: row.kind as JobEnvelope['kind'],
    resourceId: row.resourceId,
    state,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    result: row.result,
  };
}

/**
 * persists idempotent command results with operation-specific keys
 */
export function createCommandRepository(
  tx: Transaction,
  ownerId: string,
): CommandRepository {
  return {
    async get(requestOwnerId, operation, requestKey) {
      if (requestOwnerId !== ownerId) {
        return null;
      }
      const [row] = await tx
        .select()
        .from(idempotencyRequests)
        .where(
          and(
            eq(idempotencyRequests.ownerId, ownerId),
            eq(idempotencyRequests.operation, operation),
            eq(idempotencyRequests.key, requestKey),
          ),
        );
      return row && row.responseStatus !== null
        ? {
            ownerId,
            operation,
            requestKey,
            fingerprint: row.fingerprint,
            status: row.responseStatus,
            result: row.response,
          }
        : null;
    },
    async insert(receipt) {
      if (receipt.ownerId !== ownerId) {
        throw new Error('Command owner mismatch');
      }
      await tx.insert(idempotencyRequests).values({
        ownerId,
        operation: receipt.operation,
        key: receipt.requestKey,
        fingerprint: receipt.fingerprint,
        status: 'completed',
        responseStatus: receipt.status,
        response: receipt.result,
      });
    },
  };
}

/**
 * persists durable job state, steps and provider callback deduplication
 */
export function createJobRepository(
  tx: Transaction,
  ownerId: string,
): JobRepository {
  return {
    async get(id) {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(and(eq(jobs.id, id), eq(jobs.ownerId, ownerId)));
      return row ? toJob(row) : null;
    },
    async getByResource(kind, resourceId) {
      const [row] = await tx
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.ownerId, ownerId),
            eq(jobs.kind, kind),
            eq(jobs.resourceId, resourceId),
          ),
        )
        .orderBy(desc(jobs.createdAt), desc(jobs.id))
        .limit(1);
      return row ? toJob(row) : null;
    },
    async create(job) {
      await tx.insert(jobs).values({
        id: job.id,
        ownerId,
        kind: job.kind,
        resourceId: job.resourceId,
        state: job.state.kind,
        stage: 'stage' in job.state ? job.state.stage : '',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: 'completedAt' in job.state ? job.state.completedAt : null,
        error: job.state.kind === 'failed' ? job.state.error : null,
        result: job.result,
      });
    },
    async update(job, expectedUpdatedAt) {
      const changed = await tx
        .update(jobs)
        .set({
          state: job.state.kind,
          stage: 'stage' in job.state ? job.state.stage : '',
          updatedAt: job.updatedAt,
          completedAt:
            'completedAt' in job.state ? job.state.completedAt : null,
          error: job.state.kind === 'failed' ? job.state.error : null,
          result: job.result,
          revision: sql`${jobs.revision} + 1`,
        })
        .where(
          and(
            eq(jobs.id, job.id),
            eq(jobs.ownerId, ownerId),
            eq(jobs.updatedAt, expectedUpdatedAt),
            sql`${jobs.state} not in ('succeeded','partial','failed')`,
          ),
        )
        .returning({ id: jobs.id });
      return changed.length === 1;
    },
    async restartFailed(id, expectedUpdatedAt, updatedAt) {
      const [row] = await tx
        .update(jobs)
        .set({
          state: 'running',
          stage: 'retry',
          updatedAt,
          completedAt: null,
          error: null,
          result: null,
          revision: sql`${jobs.revision} + 1`,
        })
        .where(
          and(
            eq(jobs.id, id),
            eq(jobs.ownerId, ownerId),
            eq(jobs.kind, 'research'),
            eq(jobs.state, 'failed'),
            eq(jobs.updatedAt, expectedUpdatedAt),
          ),
        )
        .returning({ id: jobs.id });
      return Boolean(row);
    },
    async hasProviderEvent(provider, eventId) {
      const [event] = await tx
        .select({ jobId: providerJobMappings.jobId })
        .from(providerEvents)
        .innerJoin(
          providerJobMappings,
          eq(providerEvents.mappingId, providerJobMappings.id),
        )
        .innerJoin(
          jobs,
          and(
            eq(providerJobMappings.jobId, jobs.id),
            eq(jobs.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(providerEvents.provider, provider),
            eq(providerEvents.eventId, eventId),
          ),
        );
      return Boolean(event);
    },
    async recordProviderEvent(provider, eventId, jobId) {
      const [mapping] = await tx
        .select()
        .from(providerJobMappings)
        .innerJoin(
          jobs,
          and(
            eq(providerJobMappings.jobId, jobs.id),
            eq(jobs.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(providerJobMappings.provider, provider),
            eq(providerJobMappings.jobId, jobId),
          ),
        );
      if (!mapping) {
        throw new Error('Provider job mapping missing');
      }
      await tx
        .insert(providerEvents)
        .values({
          provider,
          eventId,
          mappingId: mapping.provider_job_mappings.id,
          payloadHash: '',
          payload: {},
        })
        .onConflictDoNothing();
    },
    async getStep(jobId, step) {
      const [row] = await tx
        .select()
        .from(jobSteps)
        .innerJoin(
          jobs,
          and(eq(jobSteps.jobId, jobs.id), eq(jobs.ownerId, ownerId)),
        )
        .where(and(eq(jobSteps.jobId, jobId), eq(jobSteps.stageKey, step)));
      return row
        ? {
            jobId,
            step,
            revision: row.job_steps.revision,
            state: row.job_steps.state as
              'ready' | 'leased' | 'waiting' | 'completed' | 'failed',
            leaseUntil: row.job_steps.leaseUntil
              ? new Date(row.job_steps.leaseUntil).toISOString()
              : null,
            checkpoint: row.job_steps.checkpoint,
            result: row.job_steps.result,
          }
        : null;
    },
    async updateStep(step, expectedRevision) {
      if (expectedRevision === 0) {
        const [job] = await tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(and(eq(jobs.id, step.jobId), eq(jobs.ownerId, ownerId)));
        if (!job) {
          return false;
        }
        const [created] = await tx
          .insert(jobSteps)
          .values({
            jobId: step.jobId,
            stageKey: step.step,
            revision: 1,
            state: step.state,
            leaseUntil: step.leaseUntil,
            checkpoint: step.checkpoint,
            result: step.result,
          })
          .onConflictDoNothing()
          .returning({ jobId: jobSteps.jobId });
        return Boolean(created);
      }
      const [row] = await tx
        .update(jobSteps)
        .set({
          revision: expectedRevision + 1,
          state: step.state,
          leaseUntil: step.leaseUntil,
          checkpoint: step.checkpoint,
          result: step.result,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(jobSteps.jobId, step.jobId),
            eq(jobSteps.stageKey, step.step),
            eq(jobSteps.revision, expectedRevision),
            sql`exists (select 1 from jobs where jobs.id = ${step.jobId} and jobs.owner_id = ${ownerId})`,
          ),
        )
        .returning({ jobId: jobSteps.jobId });
      return Boolean(row);
    },
    async getProviderJob(provider, providerJobId) {
      const [row] = await tx
        .select({
          jobId: providerJobMappings.jobId,
          step: providerJobMappings.stageKey,
        })
        .from(providerJobMappings)
        .innerJoin(
          jobs,
          and(
            eq(providerJobMappings.jobId, jobs.id),
            eq(jobs.ownerId, ownerId),
          ),
        )
        .where(
          and(
            eq(providerJobMappings.provider, provider),
            eq(providerJobMappings.providerJobId, providerJobId),
          ),
        );
      return row ?? null;
    },
    async mapProviderJob(provider, providerJobId, jobId, step) {
      const [job] = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(eq(jobs.id, jobId), eq(jobs.ownerId, ownerId)));
      if (!job) {
        throw new Error('Job not found');
      }
      await tx
        .insert(providerJobMappings)
        .values({
          id: crypto.randomUUID(),
          provider,
          providerJobId,
          jobId,
          stageKey: step,
          correlationToken: crypto.randomUUID(),
        })
        .onConflictDoNothing();
    },
  };
}

/**
 * writes outbox messages in the same transaction as business state
 */
export function createOutboxRepository(
  tx: Transaction,
  ownerId: string,
): OutboxRepository {
  return {
    async enqueue(message) {
      if (message.event.ownerId !== ownerId) {
        throw new Error('Outbox owner mismatch');
      }
      await tx.insert(outbox).values({
        eventId: message.id,
        jobId: message.event.jobId,
        eventName: message.name,
        schemaVersion: message.event.schemaVersion,
        ownerId,
        resourceId: message.event.resourceId,
        idempotencyKey: message.event.idempotencyKey,
        payload: message.event,
        createdAt: message.createdAt,
        deliveredAt: message.sentAt,
      });
    },
    async pending(limit) {
      const rows = await tx
        .select()
        .from(outbox)
        .where(
          and(
            eq(outbox.ownerId, ownerId),
            isNull(outbox.deliveredAt),
            sql`${outbox.availableAt} <= now()`,
          ),
        )
        .orderBy(asc(outbox.availableAt), asc(outbox.eventId))
        .limit(Math.min(Math.max(limit, 1), 100));
      return rows.map((row) => ({
        id: row.eventId,
        name: row.eventName,
        event: row.payload as OutboxMessage['event'],
        createdAt: row.createdAt,
        sentAt: row.deliveredAt,
      }));
    },
    async markSent(id, sentAt) {
      await tx
        .update(outbox)
        .set({ deliveredAt: sentAt })
        .where(
          and(
            eq(outbox.eventId, id),
            eq(outbox.ownerId, ownerId),
            isNull(outbox.deliveredAt),
          ),
        );
    },
  };
}

/**
 * scans due outbox events so the dispatcher can enter each event's owner transaction
 */
export async function listPendingOutbox(
  db: Database,
  limit: number,
): Promise<
  readonly (OutboxMessage & {
    readonly ownerId: string;
    readonly resourceId: string;
  })[]
> {
  const rows = await db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.deliveredAt), sql`${outbox.availableAt} <= now()`))
    .orderBy(asc(outbox.availableAt), asc(outbox.eventId))
    .limit(Math.min(Math.max(limit, 1), 100));
  return rows.map((row) => ({
    id: row.eventId,
    name: row.eventName,
    event: row.payload as OutboxMessage['event'],
    ownerId: row.ownerId,
    resourceId: row.resourceId,
    createdAt: new Date(row.createdAt).toISOString(),
    sentAt: null,
  }));
}
