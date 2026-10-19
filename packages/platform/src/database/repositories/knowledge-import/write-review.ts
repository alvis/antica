import { Prisma } from '../../generated/client.js';

import { projectionId } from '../knowledge/canonical.js';

import { insertRows } from './rows.js';

import type { ImportWriteContext } from './write.js';

/**
 * deduplicates exact aliases within each imported revision
 * @param context measured writer and prevalidated batch projections
 */
export async function writeKnowledgeRevisionAliases(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, candidates } = context;
  await insertRows(
    writer,
    'knowledge_revision_aliases',
    candidates.flatMap((candidate) =>
      [...new Set(candidate.content.aliases.map((alias) => alias.text))].map(
        (alias) => ({
          entryId: candidate.entryId,
          revision: candidate.revision,
          alias,
        }),
      ),
    ),
  );
}

/**
 * queues pending comparisons with previous pinned provider versions
 * @param context measured writer and prevalidated batch projections
 */
export async function writeReviewDiffs(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, lease, now, ownerId, candidates } = context;
  await insertRows(
    writer,
    'review_diffs',
    candidates.map((candidate) => ({
      id: projectionId(
        `${lease.run.id}:${candidate.entryId}:${candidate.revision}`,
      ),
      ownerId,
      importRunId: lease.run.id,
      entryId: candidate.entryId,
      baseRevision: candidate.prior?.revision ?? null,
      candidateRevision: candidate.revision,
      oldSourceVersionId: candidate.prior?.sourceVersionId ?? null,
      newSourceVersionId: candidate.missing ? null : candidate.versionId,
      baseContentHash: candidate.prior?.contentHash ?? null,
      candidateContentHash: candidate.contentHash,
      changes: {
        kind: candidate.missing
          ? 'missing'
          : candidate.prior
            ? 'changed'
            : 'added',
        objectId: candidate.objectId,
        previousPayloadHash: candidate.prior?.payloadHash ?? null,
        imageUrls: candidate.content.images.map((image) => image.imageUrl),
      },
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    })),
  );
}

/**
 * advances operational source heads without editing historical snapshots
 * @param context measured writer and prevalidated batch projections
 */
export async function advanceSources(
  context: ImportWriteContext,
): Promise<void> {
  const { writer, prepared, now, ownerId } = context;
  if (prepared.length) {
    const sourceIds = prepared.map((object) => object.sourceId);
    await writer.execute(
      Prisma.sql`delete from source_languages where source_id = any(${sourceIds}::uuid[])`,
    );
    await writer.execute(
      Prisma.sql`delete from source_contributors where source_id = any(${sourceIds}::uuid[])`,
    );
    await insertRows(
      writer,
      'source_languages',
      prepared.flatMap((object) =>
        object.source.languages.map((language) => ({
          sourceId: object.sourceId,
          language,
        })),
      ),
    );
    await insertRows(
      writer,
      'source_contributors',
      prepared.flatMap((object) =>
        object.source.contributors.map((nameAsPrinted, ordinal) => ({
          sourceId: object.sourceId,
          ordinal,
          nameAsPrinted,
          role: 'institution',
          attribution: 'as_printed',
        })),
      ),
    );
    await writer.execute(
      Prisma.sql`update sources s set current_version_id = v.version_id, title = v.title, revision = case when s.current_version_id is null then s.revision else s.revision + 1 end, updated_at = ${now}::timestamptz from jsonb_to_recordset(${JSON.stringify(prepared.map((object) => ({ id: object.sourceId, version_id: object.versionId, title: object.source.title })))}::jsonb) as v(id uuid, version_id uuid, title text) where s.id = v.id and s.owner_id = ${ownerId}`,
    );
  }
}
