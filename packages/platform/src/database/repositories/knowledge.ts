import { createHash } from 'node:crypto';

import { knowledgeDetailSchema } from '@antica/contracts';

import { Prisma } from '../generated/client.js';
import { jsonValue } from '../json.js';

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

import type {
  knowledgeEntries,
  knowledgeRevisions,
  methodVersions,
} from '../generated/client.js';

import type { Transaction } from '../transaction.js';

type KnowledgeCursor = {
  readonly signature: string;
  readonly updatedAt: string;
  readonly id: string;
};

interface MethodVersionRow extends Omit<methodVersions, 'definition'> {
  readonly definition: InspectionMethodVersion['definition'];
}

interface KnowledgeRevisionRow extends Omit<knowledgeRevisions, 'content'> {
  readonly content: KnowledgeContent;
}

type KnowledgeQueryRow = Pick<
  knowledgeEntries,
  'id' | 'displayCode' | 'currentRevision'
> &
  Pick<knowledgeRevisions, 'titleZhHant' | 'summaryZhHant' | 'status'> & {
    readonly updatedAt: string;
    readonly content: KnowledgeContent;
  };

/** @param value */
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** @param value */
function iso(value: Date | string): string {
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
  await tx.knowledgeRevisions.createMany({
    data: {
      entryId: entry.id,
      revision: entry.revision,
      status: entry.status,
      savedBy: entry.savedBy,
      titleZhHant: entry.content.titleZhHant,
      summaryZhHant: entry.content.summary.textZhHant,
      content: jsonValue(entry.content),
      contentHash: hash(entry.content),
      createdAt: entry.updatedAt,
    },
  });
  if (entry.content.aliases.length) {
    await tx.knowledgeRevisionAliases.createMany({
      data: entry.content.aliases.map((alias) => ({
        entryId: entry.id,
        revision: entry.revision,
        alias,
      })),
    });
  }
  if (entry.content.kinds.length) {
    await tx.knowledgeRevisionKinds.createMany({
      data: entry.content.kinds.map((kind) => ({
        entryId: entry.id,
        revision: entry.revision,
        kind,
      })),
    });
  }
  if (entry.content.citations.length) {
    await tx.knowledgeRevisionCitations.createMany({
      data: entry.content.citations.map((citation) => ({
        entryId: entry.id,
        revision: entry.revision,
        citationId: citation.id,
      })),
    });
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
 * @param tx transaction shared by the repository's knowledge operations
 * @param ownerId owner whose knowledge and methods the repository may access
 * @returns knowledge repository bound to the transaction and owner
 */
export function createKnowledgeRepository(
  tx: Transaction,
  ownerId: string,
): KnowledgeRepository {
  async function getMethod(id: string): Promise<InspectionMethod | null> {
    const row = await tx.inspectionMethods.findFirst({
      where: { id, knowledgeEntries: { ownerId } },
    });

    return row
      ? {
          id: row.id,
          owningEntryId: row.owningEntryId,
          currentVersionId: row.currentVersionId!,
        }
      : null;
  }

  async function getMethodVersion(
    id: string,
  ): Promise<InspectionMethodVersion | null> {
    const [row] = await tx.$queryRaw<MethodVersionRow[]>(Prisma.sql`
      select v."id" as "id",
      v."method_id" as "methodId",
      v."revision" as "revision",
      v."definition" as "definition",
      v."content_hash" as "contentHash",
      v."created_at" as "createdAt"
    from method_versions v
      join inspection_methods m on m.id = v.method_id
      join knowledge_entries e on e.id = m.owning_entry_id
      where v.id = ${id}::uuid and e.owner_id = ${ownerId}
    `);

    return row
      ? {
          id: row.id,
          methodId: row.methodId,
          revision: row.revision,
          definition: row.definition,
          createdAt: iso(row.createdAt),
        }
      : null;
  }

  async function get(
    id: string,
    requestedRevision?: number,
    requestedMethodVersionId?: string,
  ): Promise<KnowledgeDetail | null> {
    const [base] = await tx.knowledgeEntries.findMany({
      where: { AND: [{ id }, { ownerId }] },
    });
    if (!base) {
      return null;
    }
    const revision = requestedRevision ?? base.currentRevision;
    const [row] = await tx.$queryRaw<KnowledgeRevisionRow[]>(Prisma.sql`
      select r."entry_id" as "entryId",
      r."revision" as "revision",
      r."status" as "status",
      r."saved_by" as "savedBy",
      r."title_zh_hant" as "titleZhHant",
      r."summary_zh_hant" as "summaryZhHant",
      r."content" as "content",
      r."content_hash" as "contentHash",
      r."created_at" as "createdAt"
    from knowledge_revisions r
      where r.entry_id = ${id}::uuid and r.revision = ${revision}
    `);
    if (!row) {
      return null;
    }
    const [aliases, kinds, links, citationRows] = await Promise.all([
      tx.knowledgeRevisionAliases
        .findMany({
          where: { AND: [{ entryId: id }, { revision }] },
          select: { alias: true },
        })
        .then((rows) => rows.map((row) => ({ value: row.alias }))),
      tx.knowledgeRevisionKinds
        .findMany({
          where: { AND: [{ entryId: id }, { revision }] },
          select: { kind: true },
        })
        .then((rows) => rows.map((row) => ({ value: row.kind }))),
      tx.knowledgeRevisionMethods.findMany({
        where: { AND: [{ entryId: id }, { revision }] },
      }),
      tx.knowledgeRevisionCitations
        .findMany({
          where: { AND: [{ entryId: id }, { revision }] },
          select: { citationId: true },
        })
        .then((rows) => rows.map((row) => ({ id: row.citationId }))),
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
    const content = row.content;
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
      const result = await tx.$queryRaw<Array<{ value: bigint }>>(Prisma.sql`
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
      let cursor = query.cursor ? decodeCursor(query.cursor, signature) : null;
      const searchPattern = query.q ? `%${query.q}%` : null;
      const filtered: KnowledgeQueryRow[] = [];
      for (;;) {
        const rows = await tx.$queryRaw<KnowledgeQueryRow[]>(Prisma.sql`
          select knowledge_entries.id,
          knowledge_entries.display_code as "displayCode",
          knowledge_entries.current_revision as "currentRevision",
          knowledge_entries.updated_at::text as "updatedAt",
          knowledge_revisions.title_zh_hant as "titleZhHant",
          knowledge_revisions.summary_zh_hant as "summaryZhHant",
          knowledge_revisions.content,
          knowledge_revisions.status
          from knowledge_entries
          join knowledge_revisions on knowledge_revisions.entry_id = knowledge_entries.id
          and knowledge_revisions.revision = knowledge_entries.current_revision
          where knowledge_entries.owner_id = ${ownerId}
          ${query.status ? Prisma.sql`and knowledge_revisions.status = ${query.status}` : Prisma.empty}
          ${
            searchPattern
              ? Prisma.sql`and (
          knowledge_revisions.title_zh_hant ilike ${searchPattern}
          or exists (
          select 1 from knowledge_revision_aliases a
          where a.entry_id = knowledge_entries.id
          and a.revision = knowledge_entries.current_revision
          and a.alias ilike ${searchPattern}
          )
          )`
              : Prisma.empty
          }
          ${
            query.kinds?.length
              ? Prisma.sql`and exists (
          select 1 from knowledge_revision_kinds k
          where k.entry_id = knowledge_entries.id
          and k.revision = knowledge_entries.current_revision
          and k.kind in (${Prisma.join(query.kinds)})
          )`
              : Prisma.empty
          }
          ${
            cursor
              ? Prisma.sql`and (knowledge_entries.updated_at, knowledge_entries.id)
          < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
              : Prisma.empty
          }
          order by knowledge_entries.updated_at desc, knowledge_entries.id desc
          limit 200
        `);
        for (const row of rows) {
          if (matchesFilters(row.content, query)) {
            filtered.push(row);
          }
          if (filtered.length > limit) {
            break;
          }
        }
        if (filtered.length > limit || rows.length < 200) {
          break;
        }
        const last = rows.at(-1)!;
        cursor = { signature, updatedAt: last.updatedAt, id: last.id };
      }
      const page = filtered.slice(0, limit);
      const summaries = await Promise.all(
        page.map(async (row) => {
          const [kinds, citationCount] = await Promise.all([
            tx.knowledgeRevisionKinds.findMany({
              where: {
                AND: [{ entryId: row.id }, { revision: row.currentRevision }],
              },
              select: { kind: true },
            }),
            tx.knowledgeRevisionCitations.count({
              where: {
                entryId: row.id,
                revision: row.currentRevision,
              },
            }),
          ]);

          return {
            id: row.id,
            displayCode: row.displayCode,
            revision: row.currentRevision,
            titleZhHant: row.titleZhHant,
            kinds: kinds.map(
              (item) => item.kind as KnowledgeSummary['kinds'][number],
            ),
            status: row.status as KnowledgeSummary['status'],
            summaryZhHant: row.summaryZhHant,
            citationCount,
          };
        }),
      );
      const last = page.at(-1);

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
      await tx.knowledgeEntries.createMany({
        data: {
          id: entry.id,
          ownerId,
          displayCode: entry.displayCode,
          currentRevision: entry.revision,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
        },
      });
      await saveRevision(tx, entry);
    },
    /**
     * @param entry
     * @param expectedRevision
     */
    async addRevision(entry, expectedRevision) {
      const [changed] = await tx.knowledgeEntries.updateManyAndReturn({
        data: { currentRevision: entry.revision, updatedAt: entry.updatedAt },
        where: {
          AND: [
            { id: entry.id },
            { ownerId },
            { currentRevision: expectedRevision },
          ],
        },
        select: { id: true },
      });
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
      const [entry] = await tx.knowledgeEntries.findMany({
        where: { AND: [{ id: method.owningEntryId }, { ownerId }] },
        select: { id: true },
      });
      if (
        !entry ||
        version.methodId !== method.id ||
        method.currentVersionId !== version.id
      ) {
        throw new Error(
          'Inspection method ownership or initial version is invalid',
        );
      }
      await tx.inspectionMethods.createMany({
        data: {
          id: method.id,
          owningEntryId: method.owningEntryId,
          currentVersionId: null,
        },
      });
      await tx.methodVersions.createMany({
        data: {
          id: version.id,
          methodId: version.methodId,
          revision: version.revision,
          definition: jsonValue(version.definition),
          contentHash: hash(version.definition),
          createdAt: version.createdAt,
        },
      });
      await tx.inspectionMethods.updateMany({
        data: { currentVersionId: version.id },
        where: { id: method.id },
      });
    },
    /**
     * @param entryId
     * @param revision
     * @param methodVersionIds
     */
    async linkMethods(entryId, revision, methodVersionIds) {
      const [entry] = await tx.knowledgeEntries.findMany({
        where: { AND: [{ id: entryId }, { ownerId }] },
        select: { id: true },
      });
      if (!entry) {
        throw new Error('Knowledge entry is inaccessible');
      }
      if (!methodVersionIds.length) {
        return;
      }
      const versions = await tx.methodVersions.findMany({
        where: {
          id: { in: [...methodVersionIds] },
          inspectionMethods: { knowledgeEntries: { ownerId } },
        },
        select: { id: true, methodId: true },
      });
      if (versions.length !== new Set(methodVersionIds).size) {
        throw new Error('Inspection method version is inaccessible');
      }
      await tx.knowledgeRevisionMethods.createMany({
        data: versions.map((version) => ({
          entryId,
          revision,
          methodId: version.methodId,
          methodVersionId: version.id,
        })),
      });
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
      await tx.methodVersions.createMany({
        data: {
          id: version.id,
          methodId,
          revision: version.revision,
          definition: jsonValue(version.definition),
          contentHash: hash(version.definition),
          createdAt: version.createdAt,
        },
      });
      const [changed] = await tx.inspectionMethods.updateManyAndReturn({
        data: { currentVersionId: version.id },
        where: {
          AND: [{ id: methodId }, { currentVersionId: expectedVersionId }],
        },
        select: { id: true },
      });

      return Boolean(changed);
    },
  };
}
