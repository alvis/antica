import { Prisma } from '../generated/client.js';
import { jsonValue, nullableJson } from '../json.js';

import type {
  CommandRepository,
  JobRepository,
  OutboxMessage,
  OutboxRepository,
} from '@antica/application/ports';
import type { JobEnvelope, JobState } from '@antica/contracts';

import type { Database } from '../connection.js';
import type { jobs } from '../generated/client.js';
import type { Transaction } from '../transaction.js';

/**
 * maps a persisted job to its public envelope
 * @param row persisted job
 * @returns job envelope with normalized instants
 */
function toJob(row: jobs): JobEnvelope {
  const state: JobState =
    row.state === 'running'
      ? { kind: 'running', stage: row.stage }
      : row.state === 'waiting'
        ? { kind: 'waiting', stage: row.stage }
        : row.state === 'succeeded'
          ? { kind: 'succeeded', completedAt: row.completedAt!.toISOString() }
          : row.state === 'partial'
            ? {
                kind: 'partial',
                completedAt: row.completedAt!.toISOString(),
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
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    result: row.result,
  };
}

/**
 * persists idempotent command results with operation-specific keys
 * @param tx
 * @param ownerId
 */
export function createCommandRepository(
  tx: Transaction,
  ownerId: string,
): CommandRepository {
  return {
    /**
     * @param requestOwnerId
     * @param operation
     * @param requestKey
     */
    async get(requestOwnerId, operation, requestKey) {
      if (requestOwnerId !== ownerId) {
        return null;
      }
      const row = await tx.idempotencyRequests.findUnique({
        where: {
          ownerId_operation_key: { ownerId, operation, key: requestKey },
        },
      });

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
    /** @param receipt */
    async insert(receipt) {
      if (receipt.ownerId !== ownerId) {
        throw new Error('Command owner mismatch');
      }
      await tx.idempotencyRequests.create({
        data: {
          ownerId,
          operation: receipt.operation,
          key: receipt.requestKey,
          fingerprint: receipt.fingerprint,
          status: 'completed',
          responseStatus: receipt.status,
          response: nullableJson(receipt.result),
        },
      });
    },
  };
}

/**
 * persists durable job state, steps and provider callback deduplication
 * @param tx
 * @param ownerId
 */
export function createJobRepository(
  tx: Transaction,
  ownerId: string,
): JobRepository {
  return {
    /** @param id */
    async get(id) {
      const row = await tx.jobs.findFirst({ where: { id, ownerId } });

      return row ? toJob(row) : null;
    },
    /**
     * @param kind
     * @param resourceId
     */
    async getByResource(kind, resourceId) {
      const row = await tx.jobs.findFirst({
        where: { ownerId, kind, resourceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });

      return row ? toJob(row) : null;
    },
    /** @param job */
    async create(job) {
      await tx.jobs.create({
        data: {
          id: job.id,
          ownerId,
          kind: job.kind,
          resourceId: job.resourceId,
          state: job.state.kind,
          stage: 'stage' in job.state ? job.state.stage : '',
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
          completedAt:
            'completedAt' in job.state ? job.state.completedAt : null,
          error: nullableJson(
            job.state.kind === 'failed' ? job.state.error : null,
          ),
          result: nullableJson(job.result),
        },
      });
    },
    /**
     * @param job
     * @param expectedUpdatedAt
     */
    async update(job, expectedUpdatedAt) {
      const changed = await tx.jobs.updateMany({
        data: {
          state: job.state.kind,
          stage: 'stage' in job.state ? job.state.stage : '',
          updatedAt: job.updatedAt,
          completedAt:
            'completedAt' in job.state ? job.state.completedAt : null,
          error: nullableJson(
            job.state.kind === 'failed' ? job.state.error : null,
          ),
          result: nullableJson(job.result),
          revision: { increment: 1 },
        },
        where: {
          id: job.id,
          ownerId,
          updatedAt: expectedUpdatedAt,
          state: { notIn: ['succeeded', 'partial', 'failed'] },
        },
      });

      return changed.count === 1;
    },
    /**
     * @param id
     * @param expectedUpdatedAt
     * @param updatedAt
     */
    async restartFailed(id, expectedUpdatedAt, updatedAt) {
      const changed = await tx.jobs.updateMany({
        data: {
          state: 'running',
          stage: 'retry',
          updatedAt,
          completedAt: null,
          error: Prisma.DbNull,
          result: Prisma.DbNull,
          revision: { increment: 1 },
        },
        where: {
          id,
          ownerId,
          kind: 'research',
          state: 'failed',
          updatedAt: expectedUpdatedAt,
        },
      });

      return changed.count === 1;
    },
    /**
     * @param provider
     * @param eventId
     */
    async hasProviderEvent(provider, eventId) {
      const event = await tx.providerEvents.findFirst({
        where: {
          provider,
          eventId,
          providerJobMappings: { jobs: { ownerId } },
        },
        select: { eventId: true },
      });

      return Boolean(event);
    },
    /**
     * @param provider
     * @param eventId
     * @param jobId
     */
    async recordProviderEvent(provider, eventId, jobId) {
      const mapping = await tx.providerJobMappings.findFirst({
        where: { provider, jobId, jobs: { ownerId } },
      });
      if (!mapping) {
        throw new Error('Provider job mapping missing');
      }
      await tx.providerEvents.createMany({
        data: {
          provider,
          eventId,
          mappingId: mapping.id,
          payloadHash: '',
          payload: {},
        },
        skipDuplicates: true,
      });
    },
    /**
     * @param jobId
     * @param step
     */
    async getStep(jobId, step) {
      const row = await tx.jobSteps.findFirst({
        where: { jobId, stageKey: step, jobs: { ownerId } },
      });

      return row
        ? {
            jobId,
            step,
            revision: row.revision,
            state: row.state as
              'ready' | 'leased' | 'waiting' | 'completed' | 'failed',
            leaseUntil: row.leaseUntil?.toISOString() ?? null,
            checkpoint: row.checkpoint,
            result: row.result,
          }
        : null;
    },
    /**
     * @param step
     * @param expectedRevision
     */
    async updateStep(step, expectedRevision) {
      if (expectedRevision === 0) {
        const job = await tx.jobs.findFirst({
          where: { id: step.jobId, ownerId },
          select: { id: true },
        });
        if (!job) {
          return false;
        }
        const changed = await tx.jobSteps.createMany({
          data: {
            jobId: step.jobId,
            stageKey: step.step,
            revision: 1,
            state: step.state,
            leaseUntil: step.leaseUntil,
            checkpoint: nullableJson(step.checkpoint),
            result: nullableJson(step.result),
          },
          skipDuplicates: true,
        });

        return changed.count === 1;
      }
      // Database time retains PostgreSQL transaction-time semantics.
      const changed = await tx.$executeRaw`update job_steps set
        revision = ${expectedRevision + 1}, state = ${step.state},
        lease_until = ${step.leaseUntil}::timestamptz,
        checkpoint = ${step.checkpoint === null ? null : JSON.stringify(step.checkpoint)}::jsonb,
        result = ${step.result === null ? null : JSON.stringify(step.result)}::jsonb,
        updated_at = now()
        where job_id = ${step.jobId}::uuid and stage_key = ${step.step}
          and revision = ${expectedRevision}
          and exists (select 1 from jobs where jobs.id = ${step.jobId}::uuid and jobs.owner_id = ${ownerId})`;

      return changed === 1;
    },
    /**
     * @param provider
     * @param providerJobId
     */
    async getProviderJob(provider, providerJobId) {
      const row = await tx.providerJobMappings.findFirst({
        where: { provider, providerJobId, jobs: { ownerId } },
        select: { jobId: true, stageKey: true },
      });

      return row ? { jobId: row.jobId, step: row.stageKey } : null;
    },
    /**
     * @param provider
     * @param providerJobId
     * @param jobId
     * @param step
     */
    async mapProviderJob(provider, providerJobId, jobId, step) {
      const job = await tx.jobs.findFirst({
        where: { id: jobId, ownerId },
        select: { id: true },
      });
      if (!job) {
        throw new Error('Job not found');
      }
      await tx.providerJobMappings.createMany({
        data: {
          id: crypto.randomUUID(),
          provider,
          providerJobId,
          jobId,
          stageKey: step,
          correlationToken: crypto.randomUUID(),
        },
        skipDuplicates: true,
      });
    },
  };
}

/**
 * writes outbox messages in the same transaction as business state
 * @param tx
 * @param ownerId
 */
export function createOutboxRepository(
  tx: Transaction,
  ownerId: string,
): OutboxRepository {
  return {
    /** @param message */
    async enqueue(message) {
      if (message.event.ownerId !== ownerId) {
        throw new Error('Outbox owner mismatch');
      }
      await tx.outbox.create({
        data: {
          eventId: message.id,
          jobId: message.event.jobId,
          eventName: message.name,
          schemaVersion: message.event.schemaVersion,
          ownerId,
          resourceId: message.event.resourceId,
          idempotencyKey: message.event.idempotencyKey,
          payload: jsonValue(message.event),
          createdAt: message.createdAt,
          deliveredAt: message.sentAt,
        },
      });
    },
    /** @param limit */
    async pending(limit) {
      const rows = await tx.$queryRaw<
        Array<{
          eventId: string;
          eventName: string;
          payload: OutboxMessage['event'];
          createdAt: string;
          deliveredAt: string | null;
        }>
      >`
        select event_id as "eventId", event_name as "eventName", payload,
          to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "createdAt",
          to_char(delivered_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as "deliveredAt"
        from outbox where owner_id = ${ownerId} and delivered_at is null and available_at <= now()
        order by available_at, event_id limit ${Math.min(Math.max(limit, 1), 100)}`;

      return rows.map((row) => ({
        id: row.eventId,
        name: row.eventName,
        event: row.payload,
        createdAt: row.createdAt,
        sentAt: row.deliveredAt,
      }));
    },
    /**
     * @param id
     * @param sentAt
     */
    async markSent(id, sentAt) {
      await tx.outbox.updateMany({
        data: { deliveredAt: sentAt },
        where: { eventId: id, ownerId, deliveredAt: null },
      });
    },
  };
}

/**
 * scans due outbox events so the dispatcher can enter each event's owner transaction
 * @param db
 * @param limit
 */
export async function listPendingOutbox(
  db: Database,
  limit: number,
): Promise<
  ReadonlyArray<
    OutboxMessage & { readonly ownerId: string; readonly resourceId: string }
  >
> {
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      name: string;
      event: OutboxMessage['event'];
      ownerId: string;
      resourceId: string;
      createdAt: Date;
    }>
  >`
    with pending as (select * from outbox where delivered_at is null and available_at <= now()
      order by available_at, event_id limit ${Math.min(Math.max(limit, 1), 100)}),
    charged as (update import_runs r set counts = jsonb_set(r.counts, '{controlSqlOperations}', to_jsonb(coalesce((r.counts->>'controlSqlOperations')::int, 0) + 1))
      where r.job_id in (select job_id from pending where event_name = 'antica/knowledgeImport.requested'))
    select event_id as id, event_name as name, payload || jsonb_build_object('eventId', event_id, 'schemaVersion', schema_version, 'jobId', job_id, 'resourceId', resource_id, 'ownerId', owner_id, 'idempotencyKey', idempotency_key) as event, owner_id as "ownerId", resource_id as "resourceId", created_at as "createdAt" from pending`;

  return rows.map((row) => ({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: null,
  }));
}
