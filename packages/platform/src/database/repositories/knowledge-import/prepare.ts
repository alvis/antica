import { canonicalHash, projectionId } from '../knowledge/canonical.js';
import { projectKnowledge } from '../knowledge/projections.js';

import { bindImportDraft } from './bind.js';

import type {
  ImportBatchLease,
  ImportObjectResult,
  KnowledgeContentEnvelopeV2,
} from '@antica/contracts';

/** bulk-loaded existing identity and current payload, never a title-based match */
export interface ExistingImportObject {
  readonly objectId: string;
  readonly externalId: string;
  readonly sourceId: string;
  readonly sourceVersionId: string | null;
  readonly payloadHash: string | null;
  readonly entryId: string | null;
  readonly revision: number | null;
  readonly contentHash: string | null;
  readonly content: KnowledgeContentEnvelopeV2 | null;
  readonly status: 'active' | 'missing';
}

/** single changed object, fully validated and owner-bound before any write */
export interface PreparedImportObject {
  readonly reusedVersion?: boolean;
  readonly objectId: string;
  readonly externalId: string;
  readonly sourceId: string;
  readonly versionId: string;
  readonly entryId: string;
  readonly revision: number;
  readonly contentId: string;
  readonly content: KnowledgeContentEnvelopeV2;
  readonly contentHash: string;
  readonly snapshot: Extract<
    ImportObjectResult,
    { kind: 'snapshot' }
  >['snapshot'];
  readonly external: Extract<
    ImportObjectResult,
    { kind: 'snapshot' }
  >['mapped']['externalObject'];
  readonly source: Extract<
    ImportObjectResult,
    { kind: 'snapshot' }
  >['mapped']['source'];
  readonly prior: ExistingImportObject | undefined;
  readonly projections: ReturnType<typeof projectKnowledge>;
}

/**
 * binds adapter-local references to owner-private immutable snapshot identities
 * @param lease owner and run identities
 * @param object validated adapter output
 * @param prior bulk-loaded identity and revision
 * @returns deterministic rows for one changed object
 */
export function prepareImportObject(
  lease: ImportBatchLease,
  object: Extract<ImportObjectResult, { kind: 'snapshot' }>,
  prior: ExistingImportObject | undefined,
): PreparedImportObject {
  const { ownerId } = lease.run;
  const { snapshot, mapped } = object;
  validateSnapshot(object);
  const key = `${ownerId}:${snapshot.provider}:${snapshot.objectId}`;
  const sourceId = prior?.sourceId ?? projectionId(`${key}:source`);
  const externalId = prior?.externalId ?? projectionId(`${key}:external`);
  const versionId = projectionId(`${key}:version:${snapshot.sourceHash}`);
  const entryId = prior?.entryId ?? projectionId(`${key}:entry`);
  const revision = (prior?.revision ?? 0) + 1;
  const bind = (id: string): string =>
    projectionId(`${ownerId}:${versionId}:${id}`);
  const source = {
    ...mapped.source,
    id: sourceId,
    versionId,
    structuredSnapshot: snapshot,
  };
  const locatorIds = new Map(
    mapped.draft.citations.map(({ locator }) => [
      locator.id,
      locator.kind === 'structured'
        ? projectionId(
            `${versionId}:field:${locator.fieldPath}:${locator.valueHash}`,
          )
        : projectionId(`${versionId}:web:${canonicalHash(locator)}`),
    ]),
  );
  const content = bindImportDraft(mapped, snapshot, {
    source,
    bind,
    locatorIds,
  });

  return {
    objectId: object.objectId,
    externalId,
    sourceId,
    versionId,
    entryId,
    revision,
    contentId: `import:${snapshot.provider}:${snapshot.objectId}`,
    content,
    contentHash: canonicalHash(content),
    snapshot,
    external: mapped.externalObject,
    source,
    prior,
    projections: projectKnowledge({ ownerId, entryId, revision }, content),
  };
}

/**
 * verifies source identity against canonical captured hashes
 * @param object validated adapter snapshot and mapping
 */
function validateSnapshot(
  object: Extract<ImportObjectResult, { kind: 'snapshot' }>,
): void {
  const { snapshot, mapped } = object;
  if (
    canonicalHash(snapshot.payload) !== snapshot.payloadHash ||
    canonicalHash({
      provider: snapshot.provider,
      objectId: snapshot.objectId,
      payloadHash: snapshot.payloadHash,
      schemaVersion: snapshot.schemaVersion,
    }) !== snapshot.sourceHash ||
    mapped.externalObject.canonicalRecordUrl !== snapshot.sourcePageUrl ||
    mapped.source.canonicalUrl !== snapshot.sourcePageUrl
  ) {
    throw new Error('Mapped source differs from captured snapshot');
  }
}
