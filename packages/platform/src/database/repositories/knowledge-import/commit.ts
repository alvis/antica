import { Prisma } from '../../generated/client.js';

import { validateAssociations } from './associations.js';
import { existingImportQuery, planImportBatch } from './plan.js';
import { settleImportBatch } from './settle.js';

import { writeImportObjects } from './write.js';

import type { ImportBatch, ImportBatchLease } from '@antica/contracts';

import type { Transaction } from '../../transaction.js';

import type {
  ImportRunResultRow,
  KnowledgeImportRepositoryParams,
} from '../knowledge-import.js';

import type { ImportPlan, HistoricalImportVersion } from './plan.js';

import type { ExistingImportObject } from './prepare.js';
import type { ImportSqlWriter } from './write.js';

/**
 * looks up identities in bulk, then commits drafts, receipts and checkpoint together
 * @param params database and clock
 * @param lease persisted expected checkpoint and lease
 * @param batch fetched and validated objects; no provider IO occurs here
 * @returns whether this run has reached a terminal or paused status
 */
export async function commitImportBatch(
  params: KnowledgeImportRepositoryParams,
  lease: ImportBatchLease,
  batch: ImportBatch,
): Promise<boolean> {
  const existing = await params.db.$queryRaw<ExistingImportObject[]>(
    existingImportQuery(lease, batch),
  );
  const historical = await params.db.$queryRaw<HistoricalImportVersion[]>(
    historicalImportQuery(lease, batch),
  );
  let plan = planImportBatch(lease, batch, { existing, historical });
  let operations = 4; // bulk lookup plus the emitted BEGIN and COMMIT

  return params.db.$transaction(async (tx) => {
    const writer = measuredWriter(tx, () => {
      operations += 1;
    });
    await writer.execute(
      Prisma.sql`select pg_advisory_xact_lock(hashtextextended(${lease.run.ownerId + ':' + lease.run.provider}, 0))`,
    );
    const locked = await writer.query<ImportRunResultRow[]>(
      Prisma.sql`select to_jsonb(r) || jsonb_build_object('items', '[]'::jsonb) as run from import_runs r where r.id = ${lease.run.id}::uuid and r.owner_id = ${lease.run.ownerId} for update`,
    );
    const row = locked[0]!.run;
    if (
      row.counts.leaseToken !== lease.token ||
      row.cursor.sequence !== lease.checkpoint.sequence
    ) {
      await writer.execute(
        Prisma.sql`update import_runs set counts = jsonb_set(counts, '{controlSqlOperations}', to_jsonb(coalesce((counts->>'controlSqlOperations')::int, 0) + ${operations + 1})) where id = ${lease.run.id}::uuid`,
      );

      return false;
    }
    plan = await refreshPlan(writer, { lease, batch, plan });
    const { prepared, missing } = plan;
    const now = params.now();
    await validateAssociations(
      writer,
      lease,
      prepared.map((object) => object.content),
    );
    await writeImportObjects(writer, { lease, prepared, missing, now });

    return settleImportBatch(writer, {
      lease,
      batch,
      row,
      now,
      plan,
      nextOperationCount: () => operations + 1,
    });
  });
}

/**
 * wraps every transactional statement in the same operation counter
 * @param tx short writer transaction
 * @param charge statement accounting callback
 * @returns measured database capability
 */
function measuredWriter(tx: Transaction, charge: () => void): ImportSqlWriter {
  return {
    tx,
    execute: async (query) => {
      charge();

      return tx.$executeRaw(query);
    },
    query: async (query) => {
      charge();

      return tx.$queryRaw(query);
    },
  };
}

/**
 * captures the original pinned envelope for any previously seen source version
 * @param lease owner-private version boundary
 * @param batch captured source hashes
 * @returns one bulk historical-version lookup
 */
function historicalImportQuery(
  lease: ImportBatchLease,
  batch: ImportBatch,
): Prisma.Sql {
  const hashes = batch.objects.flatMap((object) =>
    object.kind === 'snapshot' ? [object.snapshot.sourceHash] : [],
  );

  return Prisma.sql`select v.id, k.content, v.retrieved_at as "retrievedAt" from source_versions v join lateral (select d.entry_id, d.candidate_revision from review_diffs d where d.new_source_version_id = v.id and d.owner_id = ${lease.run.ownerId} order by d.created_at limit 1) d on true join knowledge_revisions k on k.entry_id = d.entry_id and k.revision = d.candidate_revision where v.owner_id = ${lease.run.ownerId} and v.source_hash = any(${hashes}::text[])`;
}

/**
 * refreshes heads and pinned history if another import committed during fetch
 * @param writer measured writer under the provider advisory lock
 * @param input immutable batch and pretransaction plan
 * @param input.lease owner and batch lease
 * @param input.batch captured provider results
 * @param input.plan pretransaction aggregate heads
 * @returns a plan consistent with all previously committed versions
 */
async function refreshPlan(
  writer: ImportSqlWriter,
  input: {
    readonly lease: ImportBatchLease;
    readonly batch: ImportBatch;
    readonly plan: ImportPlan;
  },
): Promise<ImportPlan> {
  const { lease, batch, plan } = input;
  const heads = await writer.query<ExistingImportObject[]>(
    existingImportQuery(lease, batch),
  );
  if (
    heads.length === plan.byId.size &&
    heads.every(
      (head) =>
        head.sourceVersionId ===
          plan.byId.get(head.objectId)?.sourceVersionId &&
        head.revision === plan.byId.get(head.objectId)?.revision,
    )
  ) {
    return plan;
  }
  const historical = await writer.query<HistoricalImportVersion[]>(
    historicalImportQuery(lease, batch),
  );

  return planImportBatch(lease, batch, { existing: heads, historical });
}
