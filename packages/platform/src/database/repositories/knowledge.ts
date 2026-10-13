import { createHash } from 'node:crypto';

import { and, desc, eq, ilike, inArray, lt, or, sql } from 'drizzle-orm';

import { knowledgeDetailSchema } from '@antica/contracts';

import {
  inspectionMethods,
  knowledgeEntries,
  knowledgeRevisionAliases,
  knowledgeRevisionCitations,
  knowledgeRevisionKinds,
  knowledgeRevisionMethods,
  knowledgeRevisions,
  methodVersions,
} from '../schema/index.js';

import { readCitation, readReferenceImage } from './sources.js';

import type { KnowledgeRepository } from '@antica/application/ports';
import type {
  CursorPage,
  KnowledgeDetail,
  KnowledgeQuery,
  KnowledgeSummary,
} from '@antica/contracts';
import type {
  InspectionMethod,
  InspectionMethodVersion,
  KnowledgeContent,
  KnowledgeEntry,
  ReferenceImage,
  SourceCitation,
} from '@antica/domain';

import type { Transaction } from '../transaction.js';

type KnowledgeCursor = {
  readonly signature: string;
  readonly updatedAt: string;
  readonly id: string;
};

/** @param value */
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

/** @param query */
function querySignature(query: KnowledgeQuery): string {
  const { cursor: _cursor, limit: _limit, ...filters } = query;

  return hash(filters);
}

/**
 * @param value
 * @param signature
 */
function decodeCursor(value: string, signature: string): KnowledgeCursor {
  const cursor = JSON.parse(
    Buffer.from(value, 'base64url').toString('utf8'),
  ) as KnowledgeCursor;
  if (
    cursor.signature !== signature ||
    typeof cursor.updatedAt !== 'string' ||
    typeof cursor.id !== 'string'
  ) {
    throw new Error('Cursor does not match knowledge query');
  }

  return cursor;
}

/** @param cursor */
function encodeCursor(cursor: KnowledgeCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * @param tx
 * @param entry
 */
async function saveRevision(
  tx: Transaction,
  entry: KnowledgeEntry,
): Promise<void> {
  await tx.insert(knowledgeRevisions).values({
    entryId: entry.id,
    revision: entry.revision,
    status: entry.status,
    savedBy: entry.savedBy,
    titleZhHant: entry.content.titleZhHant,
    summaryZhHant: entry.content.summary.textZhHant,
    content: entry.content,
    contentHash: hash(entry.content),
    createdAt: entry.updatedAt,
  });
  if (entry.content.aliases.length) {
    await tx.insert(knowledgeRevisionAliases).values(
      entry.content.aliases.map((alias) => ({
        entryId: entry.id,
        revision: entry.revision,
        alias,
      })),
    );
  }
  if (entry.content.kinds.length) {
    await tx.insert(knowledgeRevisionKinds).values(
      entry.content.kinds.map((kind) => ({
        entryId: entry.id,
        revision: entry.revision,
        kind,
      })),
    );
  }
  if (entry.content.citations.length) {
    await tx.insert(knowledgeRevisionCitations).values(
      entry.content.citations.map((citation) => ({
        entryId: entry.id,
        revision: entry.revision,
        citationId: citation.id,
      })),
    );
  }
}

/**
 * @param content
 * @param query
 */
function matchesFilters(
  content: KnowledgeContent,
  query: KnowledgeQuery,
): boolean {
  const filters = query.filters;
  if (!filters) {
    return true;
  }
  const values = content.applicability.flatMap((item) => [
    ...item.objectTypeIds.map((id) => ['object', id] as const),
    ...item.materialIds.map((id) => ['material', id] as const),
    ...item.periodIds.map((id) => ['period', id] as const),
    ...item.regionIds.map((id) => ['region', id] as const),
  ]);
  const has = (kind: string, wanted: readonly string[] | undefined): boolean =>
    !wanted?.length ||
    wanted.some((id) =>
      values.some((value) => value[0] === kind && value[1] === id),
    );
  if (
    !has('object', filters.objectTypeIds) ||
    !has('material', filters.materialIds) ||
    !has('period', filters.periodIds) ||
    !has('region', filters.regionIds)
  ) {
    return false;
  }
  if (
    filters.sourceIds?.length &&
    !content.citations.some((citation) =>
      filters.sourceIds!.includes(citation.locator.sourceId),
    )
  ) {
    return false;
  }
  if (filters.includeUnknown === false && content.applicability.length === 0) {
    return false;
  }

  return true;
}

/**
 * persists immutable knowledge revisions and independently versioned inspection methods
 * @param tx
 * @param ownerId
 */
export function createKnowledgeRepository(
  tx: Transaction,
  ownerId: string,
): KnowledgeRepository {
  async function getMethod(id: string): Promise<InspectionMethod | null> {
    const [row] = await tx
      .select()
      .from(inspectionMethods)
      .innerJoin(
        knowledgeEntries,
        and(
          eq(inspectionMethods.owningEntryId, knowledgeEntries.id),
          eq(knowledgeEntries.ownerId, ownerId),
        ),
      )
      .where(eq(inspectionMethods.id, id));

    return row
      ? {
          id: row.inspection_methods.id,
          owningEntryId: row.inspection_methods.owningEntryId,
          currentVersionId: row.inspection_methods.currentVersionId!,
        }
      : null;
  }

  async function getMethodVersion(
    id: string,
  ): Promise<InspectionMethodVersion | null> {
    const [row] = await tx
      .select()
      .from(methodVersions)
      .innerJoin(
        inspectionMethods,
        eq(methodVersions.methodId, inspectionMethods.id),
      )
      .innerJoin(
        knowledgeEntries,
        and(
          eq(inspectionMethods.owningEntryId, knowledgeEntries.id),
          eq(knowledgeEntries.ownerId, ownerId),
        ),
      )
      .where(eq(methodVersions.id, id));

    return row
      ? {
          id: row.method_versions.id,
          methodId: row.method_versions.methodId,
          revision: row.method_versions.revision,
          definition: row.method_versions
            .definition as InspectionMethodVersion['definition'],
          createdAt: iso(row.method_versions.createdAt),
        }
      : null;
  }

  async function get(
    id: string,
    requestedRevision?: number,
    requestedMethodVersionId?: string,
  ): Promise<KnowledgeDetail | null> {
    const [base] = await tx
      .select()
      .from(knowledgeEntries)
      .where(
        and(eq(knowledgeEntries.id, id), eq(knowledgeEntries.ownerId, ownerId)),
      );
    if (!base) {
      return null;
    }
    const revision = requestedRevision ?? base.currentRevision;
    const [row] = await tx
      .select()
      .from(knowledgeRevisions)
      .where(
        and(
          eq(knowledgeRevisions.entryId, id),
          eq(knowledgeRevisions.revision, revision),
        ),
      );
    if (!row) {
      return null;
    }
    const [aliases, kinds, links, citationRows] = await Promise.all([
      tx
        .select({ value: knowledgeRevisionAliases.alias })
        .from(knowledgeRevisionAliases)
        .where(
          and(
            eq(knowledgeRevisionAliases.entryId, id),
            eq(knowledgeRevisionAliases.revision, revision),
          ),
        ),
      tx
        .select({ value: knowledgeRevisionKinds.kind })
        .from(knowledgeRevisionKinds)
        .where(
          and(
            eq(knowledgeRevisionKinds.entryId, id),
            eq(knowledgeRevisionKinds.revision, revision),
          ),
        ),
      tx
        .select()
        .from(knowledgeRevisionMethods)
        .where(
          and(
            eq(knowledgeRevisionMethods.entryId, id),
            eq(knowledgeRevisionMethods.revision, revision),
          ),
        ),
      tx
        .select({ id: knowledgeRevisionCitations.citationId })
        .from(knowledgeRevisionCitations)
        .where(
          and(
            eq(knowledgeRevisionCitations.entryId, id),
            eq(knowledgeRevisionCitations.revision, revision),
          ),
        ),
    ]);
    const selectedLinks = requestedMethodVersionId
      ? links.filter(
          (link) => link.methodVersionId === requestedMethodVersionId,
        )
      : links;
    if (requestedMethodVersionId && selectedLinks.length === 0) {
      return null;
    }
    const methods = (
      await Promise.all(
        selectedLinks.map(async (link) => getMethod(link.methodId)),
      )
    ).filter((method): method is InspectionMethod => method !== null);
    const versions = (
      await Promise.all(
        selectedLinks.map(async (link) =>
          getMethodVersion(link.methodVersionId),
        ),
      )
    ).filter((version): version is InspectionMethodVersion => version !== null);
    const citationsForEntry = (
      await Promise.all(
        citationRows.map(async (citation) =>
          readCitation(tx, ownerId, citation.id),
        ),
      )
    ).filter((citation): citation is SourceCitation => citation !== null);
    const content = row.content as KnowledgeContent;
    const images = (
      await Promise.all(
        content.exampleReferenceImageIds.map(async (imageId) =>
          readReferenceImage(tx, ownerId, imageId),
        ),
      )
    ).filter((image): image is ReferenceImage => image !== null);
    const entry: KnowledgeEntry = {
      id: base.id,
      revision,
      createdAt: iso(base.createdAt),
      updatedAt: iso(
        revision === base.currentRevision ? base.updatedAt : row.createdAt,
      ),
      displayCode: base.displayCode,
      status: row.status as KnowledgeEntry['status'],
      content: {
        ...content,
        aliases: aliases.map((alias) => alias.value),
        kinds: kinds.map(
          (kind) => kind.value as KnowledgeContent['kinds'][number],
        ),
        citations: citationsForEntry,
      },
      methodIds: links.map((link) => link.methodId),
      savedBy: row.savedBy as KnowledgeEntry['savedBy'],
    };

    return knowledgeDetailSchema.parse({
      entry,
      methods,
      methodVersions: versions,
      referenceImages: images,
      citations: citationsForEntry,
    });
  }

  return {
    /** */
    async allocateCode() {
      const result = await tx.execute(sql`
        insert into sequence_counters (owner_id, kind, next_value) values (${ownerId}, 'knowledge', 2)
        on conflict (owner_id, kind) do update set next_value = sequence_counters.next_value + 1
        returning next_value - 1 as value
      `);

      return `KN-${String(result[0]?.value).padStart(6, '0')}`;
    },
    get,
    /** @param query */
    async query(query): Promise<CursorPage<KnowledgeSummary>> {
      const limit = Math.min(query.limit ?? 30, 100);
      const signature = querySignature(query);
      const cursor = query.cursor
        ? decodeCursor(query.cursor, signature)
        : null;
      const searchPattern = query.q ? `%${query.q}%` : null;
      const rows = await tx
        .select({ entry: knowledgeEntries, revision: knowledgeRevisions })
        .from(knowledgeEntries)
        .innerJoin(
          knowledgeRevisions,
          and(
            eq(knowledgeRevisions.entryId, knowledgeEntries.id),
            eq(knowledgeRevisions.revision, knowledgeEntries.currentRevision),
          ),
        )
        .where(
          and(
            eq(knowledgeEntries.ownerId, ownerId),
            query.status
              ? eq(knowledgeRevisions.status, query.status)
              : undefined,
            searchPattern
              ? or(
                  ilike(knowledgeRevisions.titleZhHant, searchPattern),
                  sql`exists (select 1 from knowledge_revision_aliases a where a.entry_id = ${knowledgeEntries.id} and a.revision = ${knowledgeEntries.currentRevision} and a.alias ilike ${searchPattern})`,
                )
              : undefined,
            query.kinds?.length
              ? sql`exists (select 1 from knowledge_revision_kinds where knowledge_revision_kinds.entry_id = ${knowledgeEntries.id} and knowledge_revision_kinds.revision = ${knowledgeEntries.currentRevision} and ${inArray(knowledgeRevisionKinds.kind, query.kinds)})`
              : undefined,
            cursor
              ? or(
                  lt(knowledgeEntries.updatedAt, cursor.updatedAt),
                  and(
                    eq(knowledgeEntries.updatedAt, cursor.updatedAt),
                    lt(knowledgeEntries.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(knowledgeEntries.updatedAt), desc(knowledgeEntries.id))
        .limit(501);
      const filtered = rows.filter((row) =>
        matchesFilters(row.revision.content as KnowledgeContent, query),
      );
      const page = filtered.slice(0, limit);
      const summaries = await Promise.all(
        page.map(async (row) => {
          const [kinds, citationCount] = await Promise.all([
            tx
              .select({ kind: knowledgeRevisionKinds.kind })
              .from(knowledgeRevisionKinds)
              .where(
                and(
                  eq(knowledgeRevisionKinds.entryId, row.entry.id),
                  eq(
                    knowledgeRevisionKinds.revision,
                    row.entry.currentRevision,
                  ),
                ),
              ),
            tx.$count(
              knowledgeRevisionCitations,
              and(
                eq(knowledgeRevisionCitations.entryId, row.entry.id),
                eq(
                  knowledgeRevisionCitations.revision,
                  row.entry.currentRevision,
                ),
              ),
            ),
          ]);

          return {
            id: row.entry.id,
            displayCode: row.entry.displayCode,
            revision: row.entry.currentRevision,
            titleZhHant: row.revision.titleZhHant,
            kinds: kinds.map(
              (item) => item.kind as KnowledgeSummary['kinds'][number],
            ),
            status: row.revision.status as KnowledgeSummary['status'],
            summaryZhHant: row.revision.summaryZhHant,
            citationCount,
          };
        }),
      );
      const last = page.at(-1)?.entry;

      return {
        items: summaries,
        nextCursor:
          filtered.length > limit && last
            ? encodeCursor({
                signature,
                updatedAt: last.updatedAt,
                id: last.id,
              })
            : null,
      };
    },
    /** @param entry */
    async create(entry) {
      await tx.insert(knowledgeEntries).values({
        id: entry.id,
        ownerId,
        displayCode: entry.displayCode,
        currentRevision: entry.revision,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      });
      await saveRevision(tx, entry);
    },
    /**
     * @param entry
     * @param expectedRevision
     */
    async addRevision(entry, expectedRevision) {
      const [changed] = await tx
        .update(knowledgeEntries)
        .set({ currentRevision: entry.revision, updatedAt: entry.updatedAt })
        .where(
          and(
            eq(knowledgeEntries.id, entry.id),
            eq(knowledgeEntries.ownerId, ownerId),
            eq(knowledgeEntries.currentRevision, expectedRevision),
          ),
        )
        .returning({ id: knowledgeEntries.id });
      if (!changed) {
        return false;
      }
      await saveRevision(tx, entry);

      return true;
    },
    getMethod,
    getMethodVersion,
    /**
     * @param method
     * @param version
     */
    async createMethod(method, version) {
      const [entry] = await tx
        .select({ id: knowledgeEntries.id })
        .from(knowledgeEntries)
        .where(
          and(
            eq(knowledgeEntries.id, method.owningEntryId),
            eq(knowledgeEntries.ownerId, ownerId),
          ),
        );
      if (
        !entry ||
        version.methodId !== method.id ||
        method.currentVersionId !== version.id
      ) {
        throw new Error(
          'Inspection method ownership or initial version is invalid',
        );
      }
      await tx.insert(inspectionMethods).values({
        id: method.id,
        owningEntryId: method.owningEntryId,
        currentVersionId: null,
      });
      await tx.insert(methodVersions).values({
        id: version.id,
        methodId: version.methodId,
        revision: version.revision,
        definition: version.definition,
        contentHash: hash(version.definition),
        createdAt: version.createdAt,
      });
      await tx
        .update(inspectionMethods)
        .set({ currentVersionId: version.id })
        .where(eq(inspectionMethods.id, method.id));
    },
    /**
     * @param entryId
     * @param revision
     * @param methodVersionIds
     */
    async linkMethods(entryId, revision, methodVersionIds) {
      const [entry] = await tx
        .select({ id: knowledgeEntries.id })
        .from(knowledgeEntries)
        .where(
          and(
            eq(knowledgeEntries.id, entryId),
            eq(knowledgeEntries.ownerId, ownerId),
          ),
        );
      if (!entry) {
        throw new Error('Knowledge entry is inaccessible');
      }
      if (!methodVersionIds.length) {
        return;
      }
      const versions = await tx
        .select({ id: methodVersions.id, methodId: methodVersions.methodId })
        .from(methodVersions)
        .innerJoin(
          inspectionMethods,
          eq(methodVersions.methodId, inspectionMethods.id),
        )
        .innerJoin(
          knowledgeEntries,
          and(
            eq(inspectionMethods.owningEntryId, knowledgeEntries.id),
            eq(knowledgeEntries.ownerId, ownerId),
          ),
        )
        .where(inArray(methodVersions.id, [...methodVersionIds]));
      if (versions.length !== new Set(methodVersionIds).size) {
        throw new Error('Inspection method version is inaccessible');
      }
      await tx.insert(knowledgeRevisionMethods).values(
        versions.map((version) => ({
          entryId,
          revision,
          methodId: version.methodId,
          methodVersionId: version.id,
        })),
      );
    },
    /**
     * @param methodId
     * @param expectedVersionId
     * @param version
     */
    async addMethodVersion(methodId, expectedVersionId, version) {
      if (version.methodId !== methodId) {
        throw new Error('Inspection method version has the wrong owner');
      }
      const method = await getMethod(methodId);
      if (!method || method.currentVersionId !== expectedVersionId) {
        return false;
      }
      await tx.insert(methodVersions).values({
        id: version.id,
        methodId,
        revision: version.revision,
        definition: version.definition,
        contentHash: hash(version.definition),
        createdAt: version.createdAt,
      });
      const [changed] = await tx
        .update(inspectionMethods)
        .set({ currentVersionId: version.id })
        .where(
          and(
            eq(inspectionMethods.id, methodId),
            eq(inspectionMethods.currentVersionId, expectedVersionId),
          ),
        )
        .returning({ id: inspectionMethods.id });

      return Boolean(changed);
    },
  };
}
