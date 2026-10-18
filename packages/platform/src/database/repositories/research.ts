import { createHash } from 'node:crypto';

import { Prisma } from '../generated/client.js';

import { indexVersionId } from '../index-version.js';
import { jsonValue, nullableJson } from '../json.js';

import {
  createSourceRepository,
  readCitation,
  readSourceLocator,
  writeSourceLocator,
} from './sources.js';

import type { ResearchRepository } from '@antica/application/ports';
import type {
  CursorPage,
  JobState,
  Note,
  ReferenceLink,
  ResearchDetail,
} from '@antica/contracts';
import type { Source, SourceCitation, SourceVersion } from '@antica/domain';

import type { jobs, referenceLinks } from '../generated/client.js';

import type { Transaction } from '../transaction.js';

interface ReferenceRow extends Omit<referenceLinks, 'versions'> {
  readonly versions: ReferenceLink['versions'];
}

type ReferenceCursor = { readonly createdAt: string; readonly id: string };

/** @param value */
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** @param value */
function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

/** @param cursor */
function encodeCursor(cursor: ReferenceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** @param value */
function decodeCursor(value: string): ReferenceCursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as ReferenceCursor;
  if (typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string') {
    throw new Error('Invalid reference cursor');
  }

  return cursor;
}

/** @param row */
function toJobState(row: jobs): JobState {
  if (row.state === 'running') {
    return { kind: 'running', stage: row.stage };
  }
  if (row.state === 'waiting') {
    return { kind: 'waiting', stage: row.stage };
  }
  if (row.state === 'succeeded') {
    return { kind: 'succeeded', completedAt: iso(row.completedAt!) };
  }
  if (row.state === 'partial') {
    return {
      kind: 'partial',
      completedAt: iso(row.completedAt!),
      incompleteStages:
        (row.result as { incompleteStages?: string[] } | null)
          ?.incompleteStages ?? [],
    };
  }
  if (row.state === 'failed') {
    return {
      kind: 'failed',
      error: row.error as Extract<JobState, { kind: 'failed' }>['error'],
    };
  }

  return { kind: 'queued' };
}

/**
 * @param tx
 * @param ownerId
 * @param sourceIds
 */
async function currentVersionIds(
  tx: Transaction,
  ownerId: string,
  sourceIds: readonly string[],
): Promise<readonly string[]> {
  if (!sourceIds.length) {
    return [];
  }
  const rows = await tx.sources
    .findMany({
      where: { AND: [{ ownerId }, { id: { in: [...sourceIds] } }] },
      select: { id: true, currentVersionId: true },
    })
    .then((rows) =>
      rows.map((row) => ({
        sourceId: row.id,
        versionId: row.currentVersionId,
      })),
    );
  if (
    rows.length !== new Set(sourceIds).size ||
    rows.some((row) => row.versionId === null)
  ) {
    throw new Error('Research source is inaccessible');
  }
  const bySource = new Map(rows.map((row) => [row.sourceId, row.versionId!]));

  return sourceIds.map((id) => bySource.get(id)!);
}

/**
 * @param tx
 * @param ownerId
 * @param citation
 */
async function ensureCitation(
  tx: Transaction,
  ownerId: string,
  citation: SourceCitation,
): Promise<void> {
  const sourcesRepository = createSourceRepository(tx, ownerId);
  if (await sourcesRepository.getCitation(citation.id)) {
    return;
  }
  if (
    citation.locator.kind === 'web' &&
    !(await sourcesRepository.get(
      citation.locator.sourceId,
      citation.locator.sourceVersionId,
    ))
  ) {
    const metadata = {
      title: citation.locator.url,
      contributors: [],
      authorStatus: 'unknown' as const,
      editionStatement: null,
      publisher: null,
      publicationDateAsPrinted: null,
      isbn: null,
      languages: [],
      canonicalUrl: citation.locator.url,
      access: 'link_only' as const,
      rightsStatement: null,
      attributionText: null,
    };
    const source: Source = {
      id: citation.locator.sourceId,
      revision: 1,
      createdAt: citation.locator.retrievedAt,
      updatedAt: citation.locator.retrievedAt,
      kind: 'web',
      metadata,
      currentVersionId: citation.locator.sourceVersionId,
    };
    const version: SourceVersion = {
      id: citation.locator.sourceVersionId,
      sourceId: citation.locator.sourceId,
      originalAssetIds: [],
      sourceHash: hash({
        url: citation.locator.url,
        retrievedAt: citation.locator.retrievedAt,
      }),
      metadataSnapshot: metadata,
      capturedAt: citation.locator.retrievedAt,
      retrievedAt: citation.locator.retrievedAt,
      status: 'ready',
      textIndexStatus: 'ready',
      imageIndexStatus: 'partial',
      activeParseRunId: null,
    };
    await sourcesRepository.create(source, version, []);
  }
  await sourcesRepository.addCitation(citation);
}

/**
 * stores explicit research drafts, frozen retrievals, notes and record references
 * @param tx
 * @param ownerId
 */
export function createResearchRepository(
  tx: Transaction,
  ownerId: string,
): ResearchRepository {
  async function readNote(id: string): Promise<Note | null> {
    const row = await tx.notes.findFirst({ where: { id, ownerId } });
    if (!row) {
      return null;
    }
    const [paragraphRows, citationRows] = await Promise.all([
      tx.noteParagraphs.findMany({
        where: { noteId: id },
        orderBy: [{ ordinal: 'asc' }],
      }),
      tx.noteCitations
        .findMany({ where: { noteId: id }, select: { citationId: true } })
        .then((rows) => rows.map((row) => ({ id: row.citationId }))),
    ]);
    const citations = (
      await Promise.all(
        citationRows.map(async (citation) =>
          readCitation(tx, ownerId, citation.id),
        ),
      )
    ).filter((citation): citation is SourceCitation => citation !== null);

    return {
      id: row.id,
      researchId: row.researchId,
      titleZhHant: row.title,
      paragraphs: paragraphRows.map((paragraph) =>
        paragraph.content
          ? (paragraph.content as Note['paragraphs'][number])
          : {
              textZhHant: paragraph.text,
              citationIds: [],
              support: 'needs_source',
            },
      ),
      citations,
      recordId: row.recordId,
      entryId: row.entryId,
      savedBy: 'collector',
      savedAt: iso(row.savedAt),
    };
  }

  async function readReference(id: string): Promise<ReferenceLink | null> {
    const [row] = await tx.$queryRaw<ReferenceRow[]>(Prisma.sql`
      select r."id" as "id",
      r."owner_id" as "ownerId",
      r."target_record_id" as "targetRecordId",
      r."target_check_id" as "targetCheckId",
      r."target_observation_id" as "targetObservationId",
      r."target_anchor_id" as "targetAnchorId",
      r."subject_kind" as "subjectKind",
      r."source_locator_id" as "sourceLocatorId",
      r."reference_image_id" as "referenceImageId",
      r."subject_record_id" as "subjectRecordId",
      r."original_asset_id" as "originalAssetId",
      r."subject_anchor_id" as "subjectAnchorId",
      r."comparison_id" as "comparisonId",
      r."note" as "note",
      r."target_identity_key" as "targetIdentityKey",
      r."subject_identity_key" as "subjectIdentityKey",
      r."created_at" as "createdAt",
      r."versions" as "versions"
    from reference_links r
      where r.id = ${id}::uuid and r.owner_id = ${ownerId}
    `);
    if (!row) {
      return null;
    }
    const sourceLocator =
      row.subjectKind === 'source'
        ? await readSourceLocator(tx, ownerId, row.sourceLocatorId!)
        : null;
    if (row.subjectKind === 'source' && !sourceLocator) {
      return null;
    }
    const resolvedReference: ReferenceLink['reference'] =
      row.subjectKind === 'source'
        ? {
            kind: 'source',
            locator: sourceLocator!,
            referenceImageId: row.referenceImageId,
          }
        : {
            kind: 'collection',
            recordId: row.subjectRecordId!,
            originalAssetId: row.originalAssetId!,
            evidenceAnchorId: row.subjectAnchorId,
          };

    return {
      id: row.id,
      target: {
        recordId: row.targetRecordId,
        checkId: row.targetCheckId,
        observationId: row.targetObservationId,
        evidenceAnchorId: row.targetAnchorId,
      },
      reference: resolvedReference,
      comparisonId: row.comparisonId,
      noteZhHant: row.note ?? '',
      createdAt: iso(row.createdAt),
      versions: row.versions,
    };
  }

  async function get(id: string): Promise<ResearchDetail | null> {
    const row = await tx.researchRuns.findFirst({
      where: { id, ownerId, jobs: { ownerId } },
      include: { jobs: true },
    });
    if (!row) {
      return null;
    }
    const [sourceRows, draftRows, noteRows] = await Promise.all([
      tx.researchSources
        .findMany({
          where: { researchId: id },
          select: { sourceVersions: { select: { sourceId: true } } },
        })
        .then((rows) => rows.map((row) => row.sourceVersions)),
      tx.researchDraftRevisions.findMany({
        where: { researchId: id },
        orderBy: [{ revision: 'desc' }],
        take: 1,
      }),
      tx.notes.findMany({
        where: { AND: [{ ownerId }, { researchId: id }] },
        orderBy: [{ savedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
    ]);
    const savedNotes = (
      await Promise.all(noteRows.map(async (note) => readNote(note.id)))
    ).filter((note): note is Note => note !== null);

    return {
      researchId: row.id,
      jobId: row.jobId,
      state: toJobState(row.jobs),
      request: {
        requestKey: row.requestKey,
        instructionZhHant: row.instruction,
        scope: row.scope as ResearchDetail['request']['scope'],
        recordId: row.recordId,
        entryId: row.entryId,
        sourceIds: sourceRows.map((source) => source.sourceId),
        preferNamedAuthors: row.preferNamedAuthors === 'true',
      },
      sourceIds: [...sourceRows.map((source) => source.sourceId)],
      draft:
        (draftRows[0]?.immutableContent as ResearchDetail['draft']) ?? null,
      notes: savedNotes,
      warningsZhHant: [...(row.warnings as readonly string[])],
    };
  }

  return {
    get,
    /**
     * @param id
     * @param jobId
     * @param request
     */
    async create(id, jobId, request) {
      await tx.researchRuns.createMany({
        data: {
          id,
          ownerId,
          jobId,
          requestKey: request.requestKey,
          recordId: request.recordId,
          entryId: request.entryId,
          instruction: request.instructionZhHant,
          scope: request.scope,
          preferNamedAuthors: String(request.preferNamedAuthors),
          warnings: jsonValue([]),
        },
      });
      const versionIds = await currentVersionIds(
        tx,
        ownerId,
        request.sourceIds,
      );
      if (versionIds.length) {
        await tx.researchSources.createMany({
          data: versionIds.map((sourceVersionId) => ({
            researchId: id,
            sourceVersionId,
          })),
        });
      }
    },
    /** @param detail */
    async saveDetail(detail) {
      const [run] = await tx.researchRuns.findMany({
        where: { AND: [{ id: detail.researchId }, { ownerId }] },
        select: { id: true },
      });
      if (!run) {
        throw new Error('Research run is inaccessible');
      }
      await tx.researchRuns.updateMany({
        data: { warnings: jsonValue(detail.warningsZhHant) },
        where: { AND: [{ id: detail.researchId }, { ownerId }] },
      });
      await tx.researchSources.deleteMany({
        where: { researchId: detail.researchId },
      });
      const versionIds = await currentVersionIds(tx, ownerId, detail.sourceIds);
      if (versionIds.length) {
        await tx.researchSources.createMany({
          data: versionIds.map((sourceVersionId) => ({
            researchId: detail.researchId,
            sourceVersionId,
          })),
        });
      }
      if (detail.draft) {
        for (const citation of detail.draft.citations) {
          await ensureCitation(tx, ownerId, citation);
        }
        const contentHash = hash(detail.draft);
        const [existing] = await tx.researchDraftRevisions.findMany({
          where: {
            AND: [
              { researchId: detail.researchId },
              { revision: detail.draft.revision },
            ],
          },
          select: { contentHash: true },
        });
        if (existing && existing.contentHash !== contentHash) {
          throw new Error('Research draft revision is immutable');
        }
        if (!existing) {
          await tx.researchDraftRevisions.createMany({
            data: {
              researchId: detail.researchId,
              revision: detail.draft.revision,
              immutableContent: jsonValue(detail.draft),
              contentHash,
            },
          });
        }
      }
    },
    /** @param id */
    async getRetrievalSnapshot(id) {
      const [run] = await tx.researchRuns.findMany({
        where: { AND: [{ id }, { ownerId }] },
        select: { id: true },
      });
      if (!run) {
        return null;
      }
      const [row] = await tx.retrievalSnapshots.findMany({
        where: { AND: [{ id }, { ownerId }] },
      });

      return (
        (row?.immutablePack as Awaited<
          ReturnType<ResearchRepository['getRetrievalSnapshot']>
        >) ?? null
      );
    },
    /** @param snapshot */
    async saveRetrievalSnapshot(snapshot) {
      const [run] = await tx.researchRuns.findMany({
        where: { AND: [{ id: snapshot.id }, { ownerId }] },
        select: { id: true },
      });
      if (!run) {
        throw new Error('Research run is inaccessible');
      }
      const contentHash = hash(snapshot);
      const [existing] = await tx.retrievalSnapshots.findMany({
        where: { id: snapshot.id },
        select: { contentHash: true },
      });
      if (existing && existing.contentHash !== contentHash) {
        throw new Error('Retrieval snapshot is immutable');
      }
      if (!existing) {
        const persistedIndexId = indexVersionId(snapshot.index.indexVersion);
        await tx.indexVersions.createMany({
          data: {
            id: persistedIndexId,
            kind: 'text',
            embeddingModelId: snapshot.index.embeddingModelId,
            dimensions: snapshot.index.dimensions,
            status: 'active',
          },
          skipDuplicates: true,
        });
        const [persistedIndex] = await tx.indexVersions.findMany({
          where: { id: persistedIndexId },
        });
        if (
          !persistedIndex ||
          persistedIndex.kind !== 'text' ||
          persistedIndex.embeddingModelId !== snapshot.index.embeddingModelId ||
          persistedIndex.dimensions !== snapshot.index.dimensions
        ) {
          throw new Error('Retrieval snapshot index identity conflicts');
        }
        await tx.retrievalSnapshots.createMany({
          data: {
            id: snapshot.id,
            ownerId,
            indexVersionId: persistedIndexId,
            immutablePack: jsonValue(snapshot),
            contentHash,
            createdAt: snapshot.createdAt,
          },
        });
      }
    },
    /** @param note */
    async addNote(note) {
      const detail = await get(note.researchId);
      if (!detail) {
        throw new Error('Research run is inaccessible');
      }
      for (const citation of note.citations) {
        await ensureCitation(tx, ownerId, citation);
      }
      await tx.notes.createMany({
        data: {
          id: note.id,
          ownerId,
          researchId: note.researchId,
          draftRevision: detail.draft?.revision ?? 0,
          title: note.titleZhHant,
          recordId: note.recordId,
          entryId: note.entryId,
          savedBy: note.savedBy,
          savedAt: note.savedAt,
        },
      });
      if (note.paragraphs.length) {
        await tx.noteParagraphs.createMany({
          data: note.paragraphs.map((paragraph, ordinal) => ({
            noteId: note.id,
            ordinal,
            text: paragraph.textZhHant,
            content: nullableJson(paragraph),
          })),
        });
      }
      if (note.citations.length) {
        await tx.noteCitations.createMany({
          data: note.citations.map((citation) => ({
            noteId: note.id,
            citationId: citation.id,
          })),
        });
      }
    },
    /**
     * @param link
     * @param identity
     */
    async addReference(link, identity) {
      const sourceLocatorId = link.reference.kind === 'source' ? link.id : null;
      if (sourceLocatorId && link.reference.kind === 'source') {
        await writeSourceLocator(tx, sourceLocatorId, link.reference.locator);
      }
      await tx.referenceLinks.createMany({
        data: {
          id: link.id,
          ownerId,
          targetRecordId: link.target.recordId,
          targetCheckId: link.target.checkId,
          targetObservationId: link.target.observationId,
          targetAnchorId: link.target.evidenceAnchorId,
          subjectKind: link.reference.kind,
          sourceLocatorId,
          referenceImageId:
            link.reference.kind === 'source'
              ? link.reference.referenceImageId
              : null,
          subjectRecordId:
            link.reference.kind === 'collection'
              ? link.reference.recordId
              : null,
          originalAssetId:
            link.reference.kind === 'collection'
              ? link.reference.originalAssetId
              : null,
          subjectAnchorId:
            link.reference.kind === 'collection'
              ? link.reference.evidenceAnchorId
              : null,
          comparisonId: link.comparisonId,
          note: link.noteZhHant,
          targetIdentityKey: link.target.recordId,
          subjectIdentityKey: identity,
          versions: nullableJson(link.versions),
          createdAt: link.createdAt,
        },
      });
    },
    /** @param id */
    async getReference(id) {
      return readReference(id);
    },
    /**
     * @param recordId
     * @param identity
     */
    async findReference(recordId, identity) {
      const [row] = await tx.referenceLinks.findMany({
        where: {
          AND: [
            { ownerId },
            { targetRecordId: recordId },
            { subjectIdentityKey: identity },
          ],
        },
        select: { id: true },
      });

      return row ? readReference(row.id) : null;
    },
    /**
     * @param recordId
     * @param filters
     */
    async queryReferences(
      recordId,
      filters,
    ): Promise<CursorPage<ReferenceLink>> {
      const limit = Math.min(filters.limit ?? 50, 100);
      const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
      const rows = await tx.$queryRaw<ReferenceCursor[]>(Prisma.sql`
        select id, created_at::text as "createdAt" from reference_links
        where owner_id = ${ownerId} and target_record_id = ${recordId}::uuid
          ${filters.checkId ? Prisma.sql`and target_check_id = ${filters.checkId}::uuid` : Prisma.empty}
          ${filters.observationId ? Prisma.sql`and target_observation_id = ${filters.observationId}::uuid` : Prisma.empty}
          ${cursor ? Prisma.sql`and (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id}::uuid)` : Prisma.empty}
        order by created_at desc, id desc
        limit ${limit + 1}
      `);
      const page = rows.slice(0, limit);
      const items = (
        await Promise.all(page.map(async (row) => readReference(row.id)))
      ).filter((item): item is ReferenceLink => item !== null);
      const last = page.at(-1);

      return {
        items,
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },
  };
}
