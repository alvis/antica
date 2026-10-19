import { projectKnowledge } from '../knowledge/projections.js';

import {
  writeCitations,
  writeReferenceImages,
  writeKnowledgeEntries,
} from './write-assets.js';
import {
  writeSources,
  writeExternalObjects,
  writeSourceVersions,
  writeLocators,
} from './write-evidence.js';

import {
  writeKnowledgeRevisionAliases,
  writeReviewDiffs,
  advanceSources,
} from './write-review.js';
import {
  advanceEntries,
  writeKnowledgeRevisions,
  writeCitedClaims,
  writeLanguageVariants,
  writeCitedClaimCitations,
  writeKnowledgeRevisionTopics,
  writeKnowledgeRevisionCitations,
  writeKnowledgeRevisionMethods,
} from './write-revisions.js';

import type {
  ImportBatchLease,
  KnowledgeContentEnvelopeV2,
} from '@antica/contracts';

import type { ExistingImportObject, PreparedImportObject } from './prepare.js';
import type { ImportSqlWriter } from './rows.js';

export { insertRows } from './rows.js';
export type { ImportSqlWriter } from './rows.js';

/** A new immutable draft, including an upstream missing-object observation */
export interface RevisionCandidate {
  readonly entryId: string;
  readonly revision: number;
  readonly content: KnowledgeContentEnvelopeV2;
  readonly contentHash: string;
  readonly objectId: string;
  readonly versionId: string | null;
  readonly prior: ExistingImportObject | undefined;
  readonly missing: boolean;
}

/** validated batch data shared by bounded bulk statement writers */
export interface ImportWriteInput {
  readonly lease: ImportBatchLease;
  readonly prepared: readonly PreparedImportObject[];
  readonly missing: readonly ExistingImportObject[];
  readonly now: string;
}
export interface ImportWriteContext extends ImportWriteInput {
  readonly writer: ImportSqlWriter;
  readonly ownerId: string;
  readonly newObjects: readonly PreparedImportObject[];
  readonly captured: readonly PreparedImportObject[];
  readonly candidates: readonly RevisionCandidate[];
  readonly projections: ReadonlyArray<ReturnType<typeof projectKnowledge>>;
}
/**
 * writes immutable evidence, drafts and projections in bounded bulk statements
 * @param writer measured transactional executor
 * @param input prevalidated owner-bound candidates
 */
export async function writeImportObjects(
  writer: ImportSqlWriter,
  input: ImportWriteInput,
): Promise<void> {
  const { lease, prepared, missing } = input;
  const candidates = revisionCandidates(prepared, missing);
  const context: ImportWriteContext = {
    ...input,
    writer,
    ownerId: lease.run.ownerId,
    newObjects: prepared.filter((object) => !object.prior),
    captured: prepared.filter((object) => !object.reusedVersion),
    candidates,
    projections: candidates.map((candidate) =>
      projectKnowledge(
        {
          ownerId: lease.run.ownerId,
          entryId: candidate.entryId,
          revision: candidate.revision,
        },
        candidate.content,
      ),
    ),
  };
  await writeSources(context);
  await writeExternalObjects(context);
  await writeSourceVersions(context);
  await writeLocators(context);
  await writeCitations(context);
  await writeReferenceImages(context);
  await writeKnowledgeEntries(context);
  await advanceEntries(context);
  await writeKnowledgeRevisions(context);
  await writeCitedClaims(context);
  await writeLanguageVariants(context);
  await writeCitedClaimCitations(context);
  await writeKnowledgeRevisionTopics(context);
  await writeKnowledgeRevisionCitations(context);
  await writeKnowledgeRevisionMethods(context);
  await writeKnowledgeRevisionAliases(context);
  await writeReviewDiffs(context);
  await advanceSources(context);
}

/**
 * adds missing-object observations without deleting prior content
 * @param prepared changed snapshots
 * @param missing previously active objects now absent upstream
 * @returns draft and review candidates
 */
function revisionCandidates(
  prepared: readonly PreparedImportObject[],
  missing: readonly ExistingImportObject[],
): RevisionCandidate[] {
  return [
    ...prepared.map((object) => ({ ...object, missing: false })),
    ...missing
      .filter((object) => object.content !== null && object.entryId !== null)
      .map((object) => ({
        entryId: object.entryId!,
        revision: object.revision! + 1,
        content: object.content!,
        contentHash: object.contentHash!,
        objectId: object.objectId,
        versionId: object.sourceVersionId,
        prior: object,
        missing: true,
      })),
  ];
}
