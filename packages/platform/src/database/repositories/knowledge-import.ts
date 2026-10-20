import { randomUUID } from 'node:crypto';

import { Prisma } from '../generated/client.js';

import { canonicalHash } from './knowledge/canonical.js';
import { commitImportBatch } from './knowledge-import/commit.js';

import type {
  ImportBatchLease,
  ImportCheckpoint,
  ImportCounts,
  ImportRetryItem,
  KnowledgeImportRequest,
  KnowledgeImportRun,
  KnowledgeImportStore,
} from '@antica/contracts';

import type { Database } from '../connection.js';

/** database and clock for bounded import persistence */
export interface KnowledgeImportRepositoryParams {
  readonly db: Database;
  readonly now: () => string;
  readonly leaseMilliseconds?: number;
}

/** persisted JSON includes a lease and cancellation request, without schema additions */
export interface PersistedImportCounts extends ImportCounts {
  readonly leaseToken: string | null;
  readonly leaseUntil: string | null;
  readonly cancelRequested: boolean;
}

/** raw PostgreSQL run with a bounded receipt projection */
export interface ImportRunRow {
  readonly id: string;
  readonly ownerId: string;
  readonly jobId: string;
  readonly provider: string;
  readonly query: KnowledgeImportRequest['selection'];
  readonly queryHash: string;
  readonly adapterVersion: string;
  readonly status: KnowledgeImportRun['status'];
  readonly cursor: ImportCheckpoint;
  readonly counts: PersistedImportCounts;
  readonly failureSummary: {
    readonly reason?: string;
    readonly retryAfter?: string;
  } | null;
  readonly items: readonly ImportRetryItem[];
}

/** wraps the owner-scoped run returned by bulk SQL statements */
export interface ImportRunResultRow {
  readonly run: ImportRunRow;
}

/** maximum remaining statements, including the commit and its rollback reserve */
export const importBatchReservation = 44;
const leaseMilliseconds = 60_000;
const runProjection = Prisma.raw(
  `to_jsonb(r) || jsonb_build_object('ownerId', r.owner_id, 'jobId', r.job_id, 'queryHash', r.query_hash, 'adapterVersion', r.adapter_version, 'failureSummary', r.failure_summary, 'items', coalesce((select jsonb_agg(jsonb_build_object('objectId', i.provider_object_id, 'attemptCount', i.attempt_count, 'errorCode', i.error_code) order by i.provider_object_id) from import_items i where i.run_id = r.id and i.status = 'failed'), '[]'::jsonb))`,
);

/**
 * creates persistent import checkpoints and batched draft writes
 * @param params database and server clock
 * @returns owner-scoped import persistence
 */
export function createKnowledgeImportRepository(
  params: KnowledgeImportRepositoryParams,
): KnowledgeImportStore {
  return {
    request: async (ownerId, input, adapterVersion) =>
      request(params, ownerId, { input, adapterVersion }),
    get: async (ownerId, runId) => {
      const rows = await params.db.$queryRaw<
        ImportRunResultRow[]
      >`update import_runs r set counts = jsonb_set(counts, '{controlSqlOperations}', to_jsonb(coalesce((counts->>'controlSqlOperations')::int, 0) + 1)) where owner_id = ${ownerId} and id = ${runId}::uuid returning ${runProjection} as run`;

      return rows[0] ? importRunView(rows[0].run) : null;
    },
    control: async (ownerId, runId, action) =>
      control(params, ownerId, { runId, action }),
    claim: async (jobId) => claim(params, jobId),
    commit: async (lease, batch) => commitImportBatch(params, lease, batch),
  };
}

/**
 * creates the job, run and ID-only outbox event in one SQL statement
 * @param params database and clock
 * @param ownerId authenticated owner
 * @param command selection, request identity and reviewed mapper
 * @param command.input bounded import command
 * @param command.adapterVersion reviewed mapper version
 * @returns new or original run, or a conflicting request identity
 */
async function request(
  params: KnowledgeImportRepositoryParams,
  ownerId: string,
  command: {
    readonly input: KnowledgeImportRequest;
    readonly adapterVersion: string;
  },
): Promise<KnowledgeImportRun | 'conflict'> {
  const { input, adapterVersion } = command;
  const id = randomUUID();
  const jobId = randomUUID();
  const queryHash = canonicalHash(input.selection);
  const counts: PersistedImportCounts = {
    sqlOperations: 4,
    controlSqlOperations: 0,
    reservedOperations: 0,
    sqlOperationBudget: input.sqlOperationBudget,
    bytes: 0,
    processed: 0,
    imported: 0,
    unchanged: 0,
    failed: 0,
    batches: [],
    leaseToken: null,
    leaseUntil: null,
    cancelRequested: false,
  };
  const cursor: ImportCheckpoint = {
    version: 1,
    sequence: 0,
    schemaVersion: 2,
    manifest: input.selection.kind === 'ids' ? input.selection.objectIds : [],
    offset: 0,
    listed: input.selection.kind === 'ids',
  };
  const now = params.now();
  const rows = await params.db.$transaction(async (tx) => {
    await tx.$executeRaw`select pg_advisory_xact_lock(hashtextextended(${ownerId + ':' + input.requestKey}, 0))`;

    return tx.$queryRaw<ImportRunResultRow[]>`
    with gate as (select 1),
    prior as (select r.* from import_runs r, gate where r.owner_id = ${ownerId} and r.request_key = ${input.requestKey}),
    job as (insert into jobs (id, owner_id, kind, resource_id, state, stage, created_at, updated_at)
      select ${jobId}::uuid, ${ownerId}, 'knowledgeImport', ${id}::uuid, 'queued', 'knowledgeImport', ${now}::timestamptz, ${now}::timestamptz where not exists (select 1 from prior) returning id),
    created as (insert into import_runs (id, owner_id, job_id, provider, query, query_hash, adapter_version, request_key, cursor, status, counts, input_hash)
      select ${id}::uuid, ${ownerId}, job.id, ${input.selection.provider}, ${JSON.stringify(input.selection)}::jsonb, ${queryHash}, ${adapterVersion}, ${input.requestKey}, ${JSON.stringify(cursor)}::jsonb, 'queued', ${JSON.stringify(counts)}::jsonb, ${queryHash} from job returning *),
    event as (insert into outbox (event_id, job_id, event_name, schema_version, owner_id, resource_id, idempotency_key, payload, created_at, available_at)
      select ${randomUUID()}::uuid, job_id, 'antica/knowledgeImport.requested', '1', owner_id, id, ${randomUUID()}::uuid, jsonb_build_object('jobId', job_id), ${now}::timestamptz, ${now}::timestamptz from created),
    duplicate as (update import_runs r set counts = jsonb_set(r.counts, '{controlSqlOperations}', to_jsonb(coalesce((r.counts->>'controlSqlOperations')::int, 0) + 4)) from prior where r.id = prior.id returning r.*)
    select ${runProjection} as run from (select * from created union all select * from duplicate) r`;
  });
  const row = rows[0]!.run;

  return row.queryHash !== queryHash ||
    row.counts.sqlOperationBudget !== input.sqlOperationBudget
    ? 'conflict'
    : importRunView(row);
}

/**
 * applies owner controls atomically with job and outbox reconciliation
 * @param params database and clock
 * @param ownerId authenticated owner
 * @param command selected run and explicit operator action
 * @param command.runId selected run
 * @param command.action explicit operator action
 * @returns updated run or a restart requirement
 */
async function control(
  params: KnowledgeImportRepositoryParams,
  ownerId: string,
  command: { readonly runId: string; readonly action: 'resume' | 'cancel' },
): Promise<KnowledgeImportRun | 'restart_required' | null> {
  const now = params.now();
  const { runId, action } = command;
  const resume = action === 'resume';
  const rows = await params.db.$queryRaw<ImportRunResultRow[]>`
    with changed as (update import_runs r set
      status = case when r.status = 'completed' then r.status when ${resume} and (r.cursor->>'version')::int = 1 and (r.cursor->>'schemaVersion')::int = 2 and coalesce(r.failure_summary->>'reason', '') <> 'RESTART_REQUIRED' then 'queued'::"ImportRunStatus" when not ${resume} and coalesce((counts->>'leaseUntil')::timestamptz, '-infinity') <= ${now}::timestamptz then 'cancelled'::"ImportRunStatus" else r.status end,
      counts = counts || jsonb_build_object('controlSqlOperations', coalesce((counts->>'controlSqlOperations')::int, 0) + 1, 'cancelRequested', not ${resume}),
      failure_summary = case when ${resume} and coalesce(r.failure_summary->>'reason', '') = 'RESTART_REQUIRED' then r.failure_summary when ${resume} then null else jsonb_build_object('reason', 'CANCELLED') end,
      finished_at = case when ${resume} then null else ${now}::timestamptz end, updated_at = ${now}::timestamptz
      where r.owner_id = ${ownerId} and r.id = ${runId}::uuid returning r.*),
    job as (update jobs j set state = case when r.status = 'queued' then 'queued' when r.status = 'completed' then 'succeeded' when r.status = 'cancelled' then 'partial' else j.state end,
      stage = case when r.status = 'cancelled' then 'cancelled' else 'knowledgeImport' end, completed_at = case when r.status in ('queued','running') then null else ${now}::timestamptz end,
      updated_at = ${now}::timestamptz from changed r where j.id = r.job_id),
    settled as (update outbox o set delivered_at = ${now}::timestamptz from changed r where o.job_id = r.job_id and r.status in ('cancelled','completed')),
    event as (insert into outbox (event_id, job_id, event_name, schema_version, owner_id, resource_id, idempotency_key, payload, created_at, available_at)
      select ${randomUUID()}::uuid, job_id, 'antica/knowledgeImport.requested', '1', owner_id, id, ${randomUUID()}::uuid, jsonb_build_object('jobId',job_id), ${now}::timestamptz, ${now}::timestamptz from changed where status = 'queued'
      and not exists (select 1 from outbox where outbox.job_id = changed.job_id and delivered_at is null))
    select ${runProjection} as run from changed r`;
  const row = rows[0]?.run;
  if (!row) {
    return null;
  }
  if (
    resume &&
    (row.cursor.version !== 1 ||
      row.cursor.schemaVersion !== 2 ||
      row.failureSummary?.reason === 'RESTART_REQUIRED')
  ) {
    return 'restart_required';
  }

  return importRunView(row);
}

/**
 * reserves bounded SQL headroom and a connection-free lease in one statement
 * @param params database and clock
 * @param jobId ID-only delivery identity
 * @returns a lease or null for deferred, terminal and already leased deliveries
 */
async function claim(
  params: KnowledgeImportRepositoryParams,
  jobId: string,
): Promise<ImportBatchLease | null> {
  const now = params.now();
  const token = randomUUID();
  const until = new Date(
    Date.parse(now) + (params.leaseMilliseconds ?? leaseMilliseconds),
  ).toISOString();
  const rows = await params.db.$queryRaw<ImportRunResultRow[]>`
    with selected as (select *, (counts->>'sqlOperations')::int + (counts->>'reservedOperations')::int + 1 as used,
      status in ('queued','running') and not coalesce((counts->>'cancelRequested')::boolean,false)
      and coalesce((counts->>'leaseUntil')::timestamptz, '-infinity') <= ${now}::timestamptz
      and coalesce((failure_summary->>'retryAfter')::timestamptz, '-infinity') <= ${now}::timestamptz as eligible
      from import_runs where job_id = ${jobId}::uuid for update),
    changed as (update import_runs r set
      status = case when s.eligible and s.used + ${importBatchReservation} > (s.counts->>'sqlOperationBudget')::int then 'partial'::"ImportRunStatus" when s.eligible then 'running'::"ImportRunStatus" else r.status end,
      counts = r.counts || jsonb_build_object('sqlOperations', case when s.eligible and s.used + ${importBatchReservation} <= (s.counts->>'sqlOperationBudget')::int then s.used when s.eligible then s.used - 1 else (r.counts->>'sqlOperations')::int end,
        'controlSqlOperations', coalesce((r.counts->>'controlSqlOperations')::int, 0) + case when s.eligible and s.used + ${importBatchReservation} <= (s.counts->>'sqlOperationBudget')::int then 0 else 1 end,
        'reservedOperations', case when s.eligible and s.used + ${importBatchReservation} <= (s.counts->>'sqlOperationBudget')::int then ${importBatchReservation} when s.eligible then 0 else (r.counts->>'reservedOperations')::int end,
        'leaseToken', case when s.eligible and s.used + ${importBatchReservation} <= (s.counts->>'sqlOperationBudget')::int then ${token} else r.counts->>'leaseToken' end,
        'leaseUntil', case when s.eligible and s.used + ${importBatchReservation} <= (s.counts->>'sqlOperationBudget')::int then ${until} else r.counts->>'leaseUntil' end),
      failure_summary = case when s.eligible and s.used + ${importBatchReservation} > (s.counts->>'sqlOperationBudget')::int then jsonb_build_object('reason','SQL_OPERATION_BUDGET_EXCEEDED') else r.failure_summary end,
      started_at = coalesce(r.started_at, ${now}::timestamptz), updated_at = ${now}::timestamptz
      from selected s where r.id = s.id returning r.*),
    job as (update jobs j set state = case when r.status = 'partial' then 'partial' else 'running' end, stage = coalesce(r.failure_summary->>'reason','knowledgeImport'), completed_at = case when r.status = 'partial' then ${now}::timestamptz else null end, updated_at = ${now}::timestamptz from changed r where j.id = r.job_id and r.status in ('running','partial')),
    event as (update outbox o set delivered_at = ${now}::timestamptz from changed r where o.job_id = r.job_id and r.status in ('completed','partial','failed','cancelled'))
    select ${runProjection} as run from changed r`;
  const row = rows[0]?.run;

  return row?.counts.leaseToken === token
    ? {
        token,
        run: importRunView(row),
        checkpoint: row.cursor,
        attempts: row.items,
      }
    : null;
}

/**
 * projects persisted receipts into owner-scoped status
 * @param row persisted run and failed receipts
 * @returns public owner-scoped status
 */
export function importRunView(row: ImportRunRow): KnowledgeImportRun {
  const {
    sqlOperations,
    controlSqlOperations,
    reservedOperations,
    sqlOperationBudget,
    bytes,
    processed,
    imported,
    unchanged,
    failed,
    batches,
  } = row.counts;

  return {
    id: row.id,
    jobId: row.jobId,
    ownerId: row.ownerId,
    provider: row.provider,
    adapterVersion: row.adapterVersion,
    queryHash: row.queryHash,
    selection: row.query,
    status: row.status,
    counts: {
      sqlOperations,
      controlSqlOperations,
      reservedOperations,
      sqlOperationBudget,
      bytes,
      processed,
      imported,
      unchanged,
      failed,
      batches,
    },
    reason: row.failureSummary?.reason ?? null,
    retryAfter: row.failureSummary?.retryAfter ?? null,
    retryList: row.items,
  };
}
