import { Prisma } from '../../generated/client.js';

import { insertRows } from './rows.js';

import type { ImportWriteContext } from './write.js';

/**
 * advances expected draft heads without overwriting concurrent collector edits
 * @param context measured writer and prevalidated batch projections
 */
export async function advanceEntries(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, now, ownerId, candidates } = context;
  const existingCandidates = candidates.filter(
    (candidate) => candidate.prior?.entryId,
  );
  if (existingCandidates.length) {
    const changed = await writer.execute(
      Prisma.sql`update knowledge_entries e set current_revision = v.revision, updated_at = ${now}::timestamptz from jsonb_to_recordset(${JSON.stringify(existingCandidates.map((candidate) => ({ id: candidate.entryId, revision: candidate.revision, expected: candidate.revision - 1 })))}::jsonb) as v(id uuid, revision int, expected int) where e.id = v.id and e.owner_id = ${ownerId} and e.current_revision = v.expected`,
    );
    if (changed !== existingCandidates.length) {
      throw new Error('Import revision changed concurrently');
    }
  }
}

/**
 * appends unsaved v2 envelopes with immutable content hashes
 * @param context measured writer and prevalidated batch projections
 */
export async function writeKnowledgeRevisions(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, now, candidates } = context;
  await insertRows(
    writer,
    'knowledge_revisions',
    candidates.map((candidate) => ({
      entryId: candidate.entryId,
      revision: candidate.revision,
      contentSchemaVersion: 2,
      entryType: 'object_example',
      origin: 'open_import',
      status: 'draft',
      savedBy: null,
      titleZhHant: (
        candidate.content.titles.find(
          (title) => title.language === 'zh-Hant',
        ) ?? candidate.content.titles[0]!
      ).text,
      summaryZhHant: candidate.content.sections.summary.text,
      content: candidate.content,
      contentHash: candidate.contentHash,
      createdAt: now,
    })),
  );
}

/**
 * writes owner-private claims projected from each exact draft envelope
 * @param context measured writer and prevalidated batch projections
 */
export async function writeCitedClaims(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, projections } = context;
  await insertRows(
    writer,
    'cited_claims',
    projections.flatMap((projection) => projection.claims),
  );
}

/**
 * keeps original and translated variants pinned to their owning claims
 * @param context measured writer and prevalidated batch projections
 */
export async function writeLanguageVariants(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, projections } = context;
  await insertRows(
    writer,
    'language_variants',
    projections.flatMap((projection) => projection.variants),
  );
}

/**
 * links projected claims to captured citation identities
 * @param context measured writer and prevalidated batch projections
 */
export async function writeCitedClaimCitations(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, projections } = context;
  await insertRows(
    writer,
    'cited_claim_citations',
    projections.flatMap((projection) => projection.citations),
  );
}

/**
 * records topic membership at the exact imported revision
 * @param context measured writer and prevalidated batch projections
 */
export async function writeKnowledgeRevisionTopics(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, projections } = context;
  await insertRows(
    writer,
    'knowledge_revision_topics',
    projections.flatMap((projection) => projection.topics),
  );
}

/**
 * pins revision citation joins without changing existing evidence
 * @param context measured writer and prevalidated batch projections
 */
export async function writeKnowledgeRevisionCitations(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, candidates } = context;
  await insertRows(
    writer,
    'knowledge_revision_citations',
    candidates.flatMap((candidate) =>
      candidate.content.citations.map((citation) => ({
        entryId: candidate.entryId,
        revision: candidate.revision,
        citationId: citation.id,
      })),
    ),
  );
}

/**
 * projects each pinned method version onto its exact imported draft revision
 * @param context measured writer and validated owner-private associations
 */
export async function writeKnowledgeRevisionMethods(
  context: ImportWriteContext,
): Promise<void> {
  const links = context.candidates.flatMap((candidate) =>
    (candidate.content.methodVersionIds ?? []).map((id) => ({
      entryId: candidate.entryId,
      revision: candidate.revision,
      id,
    })),
  );
  if (!links.length) {
    return;
  }
  await context.writer.execute(
    Prisma.sql`insert into knowledge_revision_methods (entry_id, revision, method_id, method_version_id) select requested."entryId", requested.revision, v.method_id, v.id from jsonb_to_recordset(${JSON.stringify(links)}::jsonb) as requested("entryId" uuid, revision int, id uuid) join method_versions v on v.id = requested.id on conflict do nothing`,
  );
}
