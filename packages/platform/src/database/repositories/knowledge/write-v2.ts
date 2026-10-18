import { knowledgeContentEnvelopeV2Schema } from '@antica/contracts';

import { jsonValue } from '../../json.js';

import { canonicalHash } from './canonical.js';
import { projectKnowledge } from './projections.js';
import { validateReferences } from './references.js';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

import type { KnowledgeContext } from './v2.js';

/** server-authorized revision input; saved provenance is still derived from status */
export interface RevisionWrite {
  readonly entryId: string;
  readonly content: KnowledgeContentEnvelopeV2;
  readonly status: 'draft' | 'saved';
  readonly savedBy: 'collector' | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: Date | null;
}
type RevisionAppend = RevisionWrite & { readonly revision: number };

/**
 * writes pinned legacy-compatible associations from the same v2 envelope
 * @param context transaction and required owner
 * @param write exact revision being appended
 */
async function writeAssociations(
  context: KnowledgeContext,
  write: RevisionAppend,
): Promise<void> {
  const { tx, ownerId } = context;
  const { content, entryId, revision } = write;
  const versions = await tx.methodVersions.findMany({
    where: {
      id: { in: content.methodVersionIds ?? [] },
      inspectionMethods: { knowledgeEntries: { ownerId } },
    },
  });
  if (versions.length) {
    await tx.knowledgeRevisionMethods.createMany({
      data: versions.map((version) => ({
        entryId,
        revision,
        methodId: version.methodId,
        methodVersionId: version.id,
      })),
    });
  }
  if (content.citations.length) {
    await tx.knowledgeRevisionCitations.createMany({
      data: content.citations.map((citation) => ({
        entryId,
        revision,
        citationId: citation.id,
      })),
    });
  }
  if (content.aliases.length) {
    await tx.knowledgeRevisionAliases.createMany({
      data: [...new Set(content.aliases.map((alias) => alias.text))].map(
        (alias) => ({ entryId, revision, alias }),
      ),
    });
  }
}

/**
 * appends the complete canonical envelope and all deterministic projections atomically
 * @param context transaction and required owner
 * @param write exact server-authorized revision
 */
export async function appendRevision(
  context: KnowledgeContext,
  write: RevisionAppend,
): Promise<void> {
  const { tx, ownerId } = context;
  const { entryId, revision } = write;
  const content = knowledgeContentEnvelopeV2Schema.parse(write.content);
  await validateReferences(context, content);
  const title =
    content.titles.find((item) => item.language === 'zh-Hant') ??
    content.titles[0]!;
  await tx.knowledgeRevisions.create({
    data: {
      entryId,
      revision,
      contentSchemaVersion: 2,
      entryType: content.entryType,
      origin: content.origin,
      status: write.status,
      savedBy: write.status === 'saved' ? 'collector' : null,
      editorialReviewedBy: write.reviewedBy,
      editorialReviewedAt: write.reviewedAt,
      titleZhHant: title.text,
      summaryZhHant: content.sections.summary.text,
      content: jsonValue(content),
      contentHash: canonicalHash(content),
    },
  });
  const projection = projectKnowledge({ ownerId, entryId, revision }, content);
  await tx.citedClaim.createMany({ data: projection.claims });
  await tx.languageVariant.createMany({ data: projection.variants });
  if (projection.citations.length) {
    await tx.citedClaimCitation.createMany({ data: projection.citations });
  }
  if (projection.topics.length) {
    await tx.knowledgeRevisionTopic.createMany({ data: projection.topics });
  }
  await writeAssociations(context, { ...write, content });
}
