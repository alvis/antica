import { Prisma } from '../../generated/client.js';

import type { ImportBatchLease, ImportObjectResult } from '@antica/contracts';

import type { ImportSqlWriter } from './rows.js';

/**
 * bulk-checks owner-scoped links before inserting the deterministic projections
 * @param writer measured transaction writer
 * @param lease authenticated owner
 * @param contents candidate envelopes
 */
export async function validateAssociations(
  writer: ImportSqlWriter,
  lease: ImportBatchLease,
  contents: readonly PreparedContent[],
): Promise<void> {
  if (!contents.length) {
    return;
  }
  const topicIds = [
    ...new Set(
      contents.flatMap((content) =>
        content.topics.map((topic) => topic.topicId),
      ),
    ),
  ];
  const relatedIds = [
    ...new Set(contents.flatMap((content) => content.relatedEntryIds)),
  ];
  const methodIds = [
    ...new Set(contents.flatMap((content) => content.methodIds)),
  ];
  const versionLinks = contents.flatMap((content) =>
    (content.methodVersionIds ?? []).map((id) => ({
      id,
      methodIds: content.methodIds,
    })),
  );
  const referenceLinks = contents.flatMap(
    (content) => content.referenceLinks ?? [],
  );
  const [checked] = await writer.query<Array<{ valid: boolean }>>(
    Prisma.sql`select
      (select count(*) from topics where owner_id = ${lease.run.ownerId} and id = any(${topicIds}::uuid[])) = ${topicIds.length}
      and (select count(*) from knowledge_entries where owner_id = ${lease.run.ownerId} and id = any(${relatedIds}::uuid[])) = ${relatedIds.length}
      and (select count(*) from inspection_methods m join knowledge_entries e on e.id = m.owning_entry_id where e.owner_id = ${lease.run.ownerId} and m.id = any(${methodIds}::uuid[])) = ${methodIds.length}
      and not exists (select 1 from jsonb_to_recordset(${JSON.stringify(versionLinks)}::jsonb) as requested(id uuid, "methodIds" jsonb) where not exists (select 1 from method_versions v join inspection_methods m on m.id = v.method_id join knowledge_entries e on e.id = m.owning_entry_id where v.id = requested.id and e.owner_id = ${lease.run.ownerId} and requested."methodIds" ? v.method_id::text))
      and not exists (select 1 from jsonb_to_recordset(${JSON.stringify(referenceLinks)}::jsonb) as requested(id uuid, "targetRecordId" uuid, "targetCheckId" uuid, "targetObservationId" uuid, "targetAnchorId" uuid) where not exists (select 1 from reference_links l join records r on r.id = l.target_record_id where l.id = requested.id and l.owner_id = ${lease.run.ownerId} and r.owner_id = ${lease.run.ownerId} and l.target_record_id = requested."targetRecordId" and l.target_check_id is not distinct from requested."targetCheckId" and l.target_observation_id is not distinct from requested."targetObservationId" and l.target_anchor_id is not distinct from requested."targetAnchorId")) as valid`,
  );
  if (!checked!.valid) {
    throw new Error('Import references are not owner scoped');
  }
}

type PreparedContent = Extract<
  ImportObjectResult,
  { kind: 'snapshot' }
>['mapped']['draft'];
