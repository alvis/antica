import { Prisma } from '../../generated/client.js';

import { canonicalHash } from '../knowledge/canonical.js';
import { projectKnowledge } from '../knowledge/projections.js';

import { prepareImportObject } from './prepare.js';

import type {
  ImportBatch,
  ImportBatchLease,
  ImportObjectResult,
  KnowledgeContentEnvelopeV2,
} from '@antica/contracts';

import type { ExistingImportObject, PreparedImportObject } from './prepare.js';

export interface HistoricalImportVersion {
  readonly id: string;
  readonly content: KnowledgeContentEnvelopeV2;
  readonly retrievedAt: Date;
}
export interface ImportPlan {
  readonly byId: ReadonlyMap<string, ExistingImportObject>;
  readonly planned: ReadonlyArray<{
    readonly object: ImportObjectResult;
    readonly prepared: PreparedImportObject | null;
  }>;
  readonly prepared: readonly PreparedImportObject[];
  readonly missing: readonly ExistingImportObject[];
}
/**
 * selects all provider identities and current heads as one statement
 * @param lease owner and provider boundary
 * @param batch selected object handles
 * @returns bulk lookup statement
 */
export function existingImportQuery(
  lease: ImportBatchLease,
  batch: ImportBatch,
): Prisma.Sql {
  return Prisma.sql`select x.object_id as "objectId", x.id as "externalId", x.source_id as "sourceId", s.current_version_id as "sourceVersionId", v.payload_hash as "payloadHash", e.id as "entryId", e.current_revision as revision, k.content_hash as "contentHash", k.content, x.status from external_objects x join sources s on s.id = x.source_id left join source_versions v on v.id = s.current_version_id left join knowledge_entries e on e.owner_id = x.owner_id and e.content_id = 'import:' || x.provider || ':' || x.object_id left join knowledge_revisions k on k.entry_id = e.id and k.revision = e.current_revision where x.owner_id = ${lease.run.ownerId} and x.provider = ${lease.run.provider} and x.object_id = any(${batch.objects.map((object) => object.objectId)}::text[])`;
}
/**
 * prepares deterministic writes from already captured metadata
 * @param lease authenticated owner and expected checkpoint
 * @param batch captured object results
 * @param evidence current heads and historical pinned versions
 * @param evidence.existing current owner-private aggregate heads
 * @param evidence.historical immutable versions from earlier imports
 * @returns validated draft candidates and permanent mapping failures
 */
export function planImportBatch(
  lease: ImportBatchLease,
  batch: ImportBatch,
  evidence: {
    readonly existing: readonly ExistingImportObject[];
    readonly historical: readonly HistoricalImportVersion[];
  },
): ImportPlan {
  const { existing, historical } = evidence;
  const byVersion = new Map(historical.map((version) => [version.id, version]));
  const byId = new Map(existing.map((object) => [object.objectId, object]));
  const planned = batch.objects.map((object) => {
    const prior = byId.get(object.objectId);
    if (
      object.kind !== 'snapshot' ||
      prior?.payloadHash === object.snapshot.payloadHash
    ) {
      return {
        object:
          object.kind === 'snapshot'
            ? { kind: 'unchanged' as const, objectId: object.objectId }
            : object,
        prepared: null,
      };
    }
    try {
      const prepared = prepareImportObject(lease, object, prior);
      const historicalVersion = byVersion.get(prepared.versionId);
      if (historicalVersion) {
        return {
          object,
          prepared: reuseVersion(prepared, historicalVersion, lease),
        };
      }

      return { object, prepared };
    } catch {
      return {
        object: {
          kind: 'failed' as const,
          objectId: object.objectId,
          errorCode: 'INVALID_MAPPING',
          retryable: false,
        },
        prepared: null,
      };
    }
  });
  const prepared = planned.flatMap((item) =>
    item.prepared ? [item.prepared] : [],
  );
  const missing = planned
    .filter((item) => item.object.kind === 'missing')
    .flatMap((item) => {
      const prior = byId.get(item.object.objectId);

      return prior && prior.status !== 'missing' ? [prior] : [];
    });

  return { byId, planned, prepared, missing };
}

/**
 * reuses pinned evidence when an upstream payload returns to a prior value
 * @param prepared candidate aggregate revision
 * @param historicalVersion immutable prior envelope
 * @param lease current owner and run
 * @returns new draft pointing at the original evidence
 */
function reuseVersion(
  prepared: PreparedImportObject,
  historicalVersion: HistoricalImportVersion,
  lease: ImportBatchLease,
): PreparedImportObject {
  const content = historicalVersion.content;

  return {
    ...prepared,
    reusedVersion: true,
    content,
    contentHash: canonicalHash(content),
    snapshot: {
      ...prepared.snapshot,
      retrievedAt: historicalVersion.retrievedAt.toISOString(),
    },
    projections: projectKnowledge(
      {
        ownerId: lease.run.ownerId,
        entryId: prepared.entryId,
        revision: prepared.revision,
      },
      content,
    ),
  };
}
