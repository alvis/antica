import { createHash } from 'node:crypto';

import { and, asc, desc, eq, inArray, lt, or } from 'drizzle-orm';

import { indexVersionId } from '../index-version.js';
import {
  jobs,
  indexVersions,
  noteCitations,
  noteParagraphs,
  notes,
  referenceLinks,
  researchDraftRevisions,
  researchRuns,
  researchSources,
  retrievalSnapshots,
  sources,
  sourceVersions,
} from '../schema/index.js';

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
import type {
  RecordVersions,
  Source,
  SourceCitation,
  SourceVersion,
} from '@antica/domain';

import type { Transaction } from '../transaction.js';

type ReferenceCursor = { readonly createdAt: string; readonly id: string };

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

function encodeCursor(cursor: ReferenceCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(value: string): ReferenceCursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as ReferenceCursor;
  if (typeof cursor.createdAt !== 'string' || typeof cursor.id !== 'string') {
    throw new Error('Invalid reference cursor');
  }

  return cursor;
}

function toJobState(row: typeof jobs.$inferSelect): JobState {
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

async function currentVersionIds(
  tx: Transaction,
  ownerId: string,
  sourceIds: readonly string[],
): Promise<readonly string[]> {
  if (!sourceIds.length) {
    return [];
  }
  const rows = await tx
    .select({ sourceId: sources.id, versionId: sources.currentVersionId })
    .from(sources)
    .where(
      and(eq(sources.ownerId, ownerId), inArray(sources.id, [...sourceIds])),
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
    const [row] = await tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const [paragraphRows, citationRows] = await Promise.all([
      tx
        .select()
        .from(noteParagraphs)
        .where(eq(noteParagraphs.noteId, id))
        .orderBy(asc(noteParagraphs.ordinal)),
      tx
        .select({ id: noteCitations.citationId })
        .from(noteCitations)
        .where(eq(noteCitations.noteId, id)),
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
    const [row] = await tx
      .select()
      .from(referenceLinks)
      .where(
        and(eq(referenceLinks.id, id), eq(referenceLinks.ownerId, ownerId)),
      );
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
      versions: row.versions as RecordVersions,
    };
  }

  async function get(id: string): Promise<ResearchDetail | null> {
    const [row] = await tx
      .select()
      .from(researchRuns)
      .innerJoin(
        jobs,
        and(eq(researchRuns.jobId, jobs.id), eq(jobs.ownerId, ownerId)),
      )
      .where(and(eq(researchRuns.id, id), eq(researchRuns.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const [sourceRows, draftRows, noteRows] = await Promise.all([
      tx
        .select({ sourceId: sourceVersions.sourceId })
        .from(researchSources)
        .innerJoin(
          sourceVersions,
          eq(researchSources.sourceVersionId, sourceVersions.id),
        )
        .where(eq(researchSources.researchId, id)),
      tx
        .select()
        .from(researchDraftRevisions)
        .where(eq(researchDraftRevisions.researchId, id))
        .orderBy(desc(researchDraftRevisions.revision))
        .limit(1),
      tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.ownerId, ownerId), eq(notes.researchId, id)))
        .orderBy(asc(notes.savedAt), asc(notes.id)),
    ]);
    const savedNotes = (
      await Promise.all(noteRows.map(async (note) => readNote(note.id)))
    ).filter((note): note is Note => note !== null);

    return {
      researchId: row.research_runs.id,
      jobId: row.research_runs.jobId,
      state: toJobState(row.jobs),
      request: {
        requestKey: row.research_runs.requestKey,
        instructionZhHant: row.research_runs.instruction,
        scope: row.research_runs.scope as ResearchDetail['request']['scope'],
        recordId: row.research_runs.recordId,
        entryId: row.research_runs.entryId,
        sourceIds: sourceRows.map((source) => source.sourceId),
        preferNamedAuthors: row.research_runs.preferNamedAuthors === 'true',
      },
      sourceIds: [...sourceRows.map((source) => source.sourceId)],
      draft:
        (draftRows[0]?.immutableContent as ResearchDetail['draft']) ?? null,
      notes: savedNotes,
      warningsZhHant: [...(row.research_runs.warnings as readonly string[])],
    };
  }

  return {
    get,
    async create(id, jobId, request) {
      await tx.insert(researchRuns).values({
        id,
        ownerId,
        jobId,
        requestKey: request.requestKey,
        recordId: request.recordId,
        entryId: request.entryId,
        instruction: request.instructionZhHant,
        scope: request.scope,
        preferNamedAuthors: String(request.preferNamedAuthors),
        warnings: [],
      });
      const versionIds = await currentVersionIds(
        tx,
        ownerId,
        request.sourceIds,
      );
      if (versionIds.length) {
        await tx.insert(researchSources).values(
          versionIds.map((sourceVersionId) => ({
            researchId: id,
            sourceVersionId,
          })),
        );
      }
    },
    async saveDetail(detail) {
      const [run] = await tx
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.id, detail.researchId),
            eq(researchRuns.ownerId, ownerId),
          ),
        );
      if (!run) {
        throw new Error('Research run is inaccessible');
      }
      await tx
        .update(researchRuns)
        .set({ warnings: detail.warningsZhHant })
        .where(
          and(
            eq(researchRuns.id, detail.researchId),
            eq(researchRuns.ownerId, ownerId),
          ),
        );
      await tx
        .delete(researchSources)
        .where(eq(researchSources.researchId, detail.researchId));
      const versionIds = await currentVersionIds(tx, ownerId, detail.sourceIds);
      if (versionIds.length) {
        await tx.insert(researchSources).values(
          versionIds.map((sourceVersionId) => ({
            researchId: detail.researchId,
            sourceVersionId,
          })),
        );
      }
      if (detail.draft) {
        for (const citation of detail.draft.citations) {
          await ensureCitation(tx, ownerId, citation);
        }
        const contentHash = hash(detail.draft);
        const [existing] = await tx
          .select({ contentHash: researchDraftRevisions.contentHash })
          .from(researchDraftRevisions)
          .where(
            and(
              eq(researchDraftRevisions.researchId, detail.researchId),
              eq(researchDraftRevisions.revision, detail.draft.revision),
            ),
          );
        if (existing && existing.contentHash !== contentHash) {
          throw new Error('Research draft revision is immutable');
        }
        if (!existing) {
          await tx.insert(researchDraftRevisions).values({
            researchId: detail.researchId,
            revision: detail.draft.revision,
            immutableContent: detail.draft,
            contentHash,
          });
        }
      }
    },
    async getRetrievalSnapshot(id) {
      const [run] = await tx
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(and(eq(researchRuns.id, id), eq(researchRuns.ownerId, ownerId)));
      if (!run) {
        return null;
      }
      const [row] = await tx
        .select()
        .from(retrievalSnapshots)
        .where(
          and(
            eq(retrievalSnapshots.id, id),
            eq(retrievalSnapshots.ownerId, ownerId),
          ),
        );

      return (
        (row?.immutablePack as Awaited<
          ReturnType<ResearchRepository['getRetrievalSnapshot']>
        >) ?? null
      );
    },
    async saveRetrievalSnapshot(snapshot) {
      const [run] = await tx
        .select({ id: researchRuns.id })
        .from(researchRuns)
        .where(
          and(
            eq(researchRuns.id, snapshot.id),
            eq(researchRuns.ownerId, ownerId),
          ),
        );
      if (!run) {
        throw new Error('Research run is inaccessible');
      }
      const contentHash = hash(snapshot);
      const [existing] = await tx
        .select({ contentHash: retrievalSnapshots.contentHash })
        .from(retrievalSnapshots)
        .where(eq(retrievalSnapshots.id, snapshot.id));
      if (existing && existing.contentHash !== contentHash) {
        throw new Error('Retrieval snapshot is immutable');
      }
      if (!existing) {
        const persistedIndexId = indexVersionId(snapshot.index.indexVersion);
        await tx
          .insert(indexVersions)
          .values({
            id: persistedIndexId,
            kind: 'text',
            embeddingModelId: snapshot.index.embeddingModelId,
            dimensions: snapshot.index.dimensions,
            status: 'active',
          })
          .onConflictDoNothing();
        const [persistedIndex] = await tx
          .select()
          .from(indexVersions)
          .where(eq(indexVersions.id, persistedIndexId));
        if (
          !persistedIndex ||
          persistedIndex.kind !== 'text' ||
          persistedIndex.embeddingModelId !== snapshot.index.embeddingModelId ||
          persistedIndex.dimensions !== snapshot.index.dimensions
        ) {
          throw new Error('Retrieval snapshot index identity conflicts');
        }
        await tx.insert(retrievalSnapshots).values({
          id: snapshot.id,
          ownerId,
          indexVersionId: persistedIndexId,
          immutablePack: snapshot,
          contentHash,
          createdAt: snapshot.createdAt,
        });
      }
    },
    async addNote(note) {
      const detail = await get(note.researchId);
      if (!detail) {
        throw new Error('Research run is inaccessible');
      }
      for (const citation of note.citations) {
        await ensureCitation(tx, ownerId, citation);
      }
      await tx.insert(notes).values({
        id: note.id,
        ownerId,
        researchId: note.researchId,
        draftRevision: detail.draft?.revision ?? 0,
        title: note.titleZhHant,
        recordId: note.recordId,
        entryId: note.entryId,
        savedBy: note.savedBy,
        savedAt: note.savedAt,
      });
      if (note.paragraphs.length) {
        await tx.insert(noteParagraphs).values(
          note.paragraphs.map((paragraph, ordinal) => ({
            noteId: note.id,
            ordinal,
            text: paragraph.textZhHant,
            content: paragraph,
          })),
        );
      }
      if (note.citations.length) {
        await tx.insert(noteCitations).values(
          note.citations.map((citation) => ({
            noteId: note.id,
            citationId: citation.id,
          })),
        );
      }
    },
    async addReference(link, identity) {
      const sourceLocatorId = link.reference.kind === 'source' ? link.id : null;
      if (sourceLocatorId && link.reference.kind === 'source') {
        await writeSourceLocator(tx, sourceLocatorId, link.reference.locator);
      }
      await tx.insert(referenceLinks).values({
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
          link.reference.kind === 'collection' ? link.reference.recordId : null,
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
        versions: link.versions,
        createdAt: link.createdAt,
      });
    },
    async getReference(id) {
      return readReference(id);
    },
    async findReference(recordId, identity) {
      const [row] = await tx
        .select({ id: referenceLinks.id })
        .from(referenceLinks)
        .where(
          and(
            eq(referenceLinks.ownerId, ownerId),
            eq(referenceLinks.targetRecordId, recordId),
            eq(referenceLinks.subjectIdentityKey, identity),
          ),
        );

      return row ? readReference(row.id) : null;
    },
    async queryReferences(
      recordId,
      filters,
    ): Promise<CursorPage<ReferenceLink>> {
      const limit = Math.min(filters.limit ?? 50, 100);
      const cursor = filters.cursor ? decodeCursor(filters.cursor) : null;
      const rows = await tx
        .select({ id: referenceLinks.id, createdAt: referenceLinks.createdAt })
        .from(referenceLinks)
        .where(
          and(
            eq(referenceLinks.ownerId, ownerId),
            eq(referenceLinks.targetRecordId, recordId),
            filters.checkId
              ? eq(referenceLinks.targetCheckId, filters.checkId)
              : undefined,
            filters.observationId
              ? eq(referenceLinks.targetObservationId, filters.observationId)
              : undefined,
            cursor
              ? or(
                  lt(referenceLinks.createdAt, cursor.createdAt),
                  and(
                    eq(referenceLinks.createdAt, cursor.createdAt),
                    lt(referenceLinks.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(referenceLinks.createdAt), desc(referenceLinks.id))
        .limit(limit + 1);
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
