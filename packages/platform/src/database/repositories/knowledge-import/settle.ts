import { randomUUID } from 'node:crypto';

import { Prisma } from '../../generated/client.js';

import { canonicalHash } from '../knowledge/canonical.js';

import { insertRows } from './rows.js';

import type {
  ImportBatch,
  ImportBatchLease,
  KnowledgeImportRun,
} from '@antica/contracts';

import type {
  ImportRunRow,
  PersistedImportCounts,
} from '../knowledge-import.js';

import type { ImportPlan } from './plan.js';
import type { ImportSqlWriter } from './rows.js';

interface Settlement {
  readonly lease: ImportBatchLease;
  readonly batch: ImportBatch;
  readonly row: ImportRunRow;
  readonly plan: ImportPlan;
  readonly now: string;
}
interface Receipt {
  readonly providerObjectId: string;
  readonly payloadHash: string | null;
  readonly status: string;
  readonly attemptCount: number;
  readonly errorCode: string | null;
}
interface Outcome {
  readonly status: KnowledgeImportRun['status'];
  readonly reason: string | null;
  readonly retryAfter: string | null;
}
const maximumAttempts = 3;
/**
 * writes per-object observations and receipts in bulk
 * @param writer measured statement executor
 * @param input current atomic settlement
 */
export async function writeImportReceipts(
  writer: ImportSqlWriter,
  input: Settlement,
): Promise<void> {
  const {
    lease,
    now,
    plan: { planned },
  } = input;
  const observed = planned
    .filter((item) => item.object.kind !== 'failed')
    .map((item) => ({
      object_id: item.object.objectId,
      status: item.object.kind === 'missing' ? 'missing' : 'active',
    }));
  if (observed.length) {
    await writer.execute(
      Prisma.sql`update external_objects x set status = v.status::"ExternalObjectStatus", last_seen_at = ${now}::timestamptz, updated_at = ${now}::timestamptz from jsonb_to_recordset(${JSON.stringify(observed)}::jsonb) as v(object_id text, status text) where x.owner_id = ${lease.run.ownerId} and x.provider = ${lease.run.provider} and x.object_id = v.object_id`,
    );
  }
}

/**
 * writes durable object receipts without per-object queries
 * @param writer measured statement executor
 * @param input current atomic settlement
 */
async function writeReceipts(
  writer: ImportSqlWriter,
  input: Settlement,
): Promise<void> {
  const {
    lease,
    now,
    plan: { byId, planned },
  } = input;
  const receipts = planned.map((item) => {
    const object = item.object;
    const prior = byId.get(object.objectId);

    return {
      objectId: object.objectId,
      payloadHash:
        object.kind === 'snapshot'
          ? object.snapshot.payloadHash
          : (prior?.payloadHash ?? null),
      status:
        object.kind === 'failed'
          ? 'failed'
          : object.kind === 'snapshot'
            ? 'imported'
            : 'unchanged',
      errorCode:
        object.kind === 'failed'
          ? object.retryable
            ? object.errorCode
            : `PERMANENT:${object.errorCode}`
          : object.kind === 'missing'
            ? 'MISSING_UPSTREAM'
            : null,
      sourceVersionId:
        item.prepared?.versionId ?? prior?.sourceVersionId ?? null,
    };
  });
  if (receipts.length) {
    await writer.execute(
      Prisma.sql`insert into import_items (run_id, provider_object_id, payload_hash, status, attempt_count, error_code, source_version_id, updated_at) select ${lease.run.id}::uuid, v."objectId", v."payloadHash", v.status::"ImportItemStatus", 1, v."errorCode", v."sourceVersionId", ${now}::timestamptz from jsonb_to_recordset(${JSON.stringify(receipts)}::jsonb) as v("objectId" text, "payloadHash" text, status text, "errorCode" text, "sourceVersionId" uuid) on conflict (run_id, provider_object_id) do update set payload_hash = excluded.payload_hash, status = excluded.status, attempt_count = import_items.attempt_count + 1, error_code = excluded.error_code, source_version_id = excluded.source_version_id, updated_at = excluded.updated_at`,
    );
  }
}

/**
 * derives terminal, deferred and cancelled status from committed receipts
 * @param batch bounded fetched batch
 * @param row locked run and operator cancellation flag
 * @param items durable per-object attempts
 * @returns atomic job and run outcome
 */
function batchOutcome(
  batch: ImportBatch,
  row: ImportRunRow,
  items: readonly Receipt[],
): Outcome {
  const failures = items.filter((item) => item.status === 'failed');
  const retryable = failures.some(
    (item) =>
      item.attemptCount < maximumAttempts &&
      !item.errorCode?.startsWith('PERMANENT:'),
  );
  const more =
    !batch.checkpoint.listed ||
    batch.checkpoint.offset < batch.checkpoint.manifest.length ||
    retryable;
  if (row.counts.cancelRequested) {
    return { status: 'cancelled', reason: 'CANCELLED', retryAfter: null };
  }
  const status = batch.stop
    ? 'partial'
    : more
      ? 'running'
      : failures.length
        ? 'partial'
        : 'completed';
  const reason = batch.stop
    ? batch.reason
    : status === 'partial'
      ? 'ITEM_ATTEMPTS_EXHAUSTED'
      : batch.reason;

  return { status, reason, retryAfter: batch.retryAfter };
}

/**
 * settles the current delivery and queues its next ID-only batch
 * @param writer measured transaction executor
 * @param input committed checkpoint and clock
 * @param outcome next run status and retry deadline
 */
async function writeDelivery(
  writer: ImportSqlWriter,
  input: Settlement,
  outcome: Outcome,
): Promise<void> {
  const { lease, now } = input;
  const { status, reason, retryAfter } = outcome;
  await writer.execute(
    Prisma.sql`update jobs set state = ${status === 'completed' ? 'succeeded' : status === 'cancelled' || status === 'partial' ? 'partial' : retryAfter ? 'waiting' : 'running'}, stage = ${reason ?? 'knowledgeImport'}, result = ${JSON.stringify({ runId: lease.run.id, incompleteStages: reason ? [reason] : [] })}::jsonb, completed_at = ${status === 'running' ? null : now}::timestamptz, updated_at = ${now}::timestamptz where id = ${lease.run.jobId}::uuid and owner_id = ${lease.run.ownerId}`,
  );
  await writer.execute(
    Prisma.sql`update outbox set delivered_at = ${now}::timestamptz where job_id = ${lease.run.jobId}::uuid and delivered_at is null`,
  );
  if (status === 'running') {
    await insertRows(writer, 'outbox', [
      {
        eventId: randomUUID(),
        jobId: lease.run.jobId,
        eventName: 'antica/knowledgeImport.requested',
        schemaVersion: '1',
        ownerId: lease.run.ownerId,
        resourceId: lease.run.id,
        idempotencyKey: randomUUID(),
        payload: { jobId: lease.run.jobId },
        createdAt: now,
        availableAt: retryAfter ?? now,
      },
    ]);
  }
}

/**
 * saves counts and checkpoint last in the same measured transaction
 * @param writer measured statement executor
 * @param input locked settlement and counter callback
 * @returns whether this run has reached a terminal or paused status
 */
export async function settleImportBatch(
  writer: ImportSqlWriter,
  input: Settlement & { readonly nextOperationCount: () => number },
): Promise<boolean> {
  const { lease, batch, row, now, nextOperationCount } = input;
  await writeImportReceipts(writer, input);
  await writeReceipts(writer, input);
  const items = await writer.query<Receipt[]>(
    Prisma.sql`select provider_object_id as "providerObjectId", payload_hash as "payloadHash", status, attempt_count as "attemptCount", error_code as "errorCode" from import_items where run_id = ${lease.run.id}::uuid`,
  );
  const { status, reason, retryAfter } = batchOutcome(batch, row, items);
  await writeDelivery(writer, input, { status, reason, retryAfter });
  const sqlOperations = nextOperationCount();
  if (sqlOperations > row.counts.reservedOperations) {
    throw new Error('Import SQL reservation was underestimated');
  }
  const counts: PersistedImportCounts = {
    ...row.counts,
    sqlOperations: row.counts.sqlOperations + sqlOperations,
    reservedOperations: 0,
    bytes:
      row.counts.bytes +
      batch.objects.reduce(
        (sum, object) => sum + (object.kind === 'snapshot' ? object.bytes : 0),
        0,
      ),
    processed: items.length,
    imported: items.filter((item) => item.status === 'imported').length,
    unchanged: items.filter((item) => item.status === 'unchanged').length,
    failed: items.filter((item) => item.status === 'failed').length,
    batches: [...row.counts.batches, sqlOperations + 1],
    leaseToken: null,
    leaseUntil: null,
  };
  await writer.execute(
    Prisma.sql`update import_runs set counts = ${JSON.stringify(counts)}::jsonb, cursor = ${JSON.stringify({ ...batch.checkpoint, sequence: row.cursor.sequence + 1 })}::jsonb, status = ${status}::"ImportRunStatus", failure_summary = ${JSON.stringify(reason || retryAfter ? { reason, retryAfter } : null)}::jsonb, output_hash = ${canonicalHash(items.map((item) => ({ objectId: item.providerObjectId, payloadHash: item.payloadHash, status: item.status })).sort((a, b) => a.objectId.localeCompare(b.objectId)))}, finished_at = ${status === 'running' ? null : now}::timestamptz, updated_at = ${now}::timestamptz where id = ${lease.run.id}::uuid`,
  );

  return status !== 'running';
}
