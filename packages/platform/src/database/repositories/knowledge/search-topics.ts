import {
  knowledgeTopicsPageSchema,
  knowledgeTopicTreeSchema,
} from '@antica/contracts';

import { Prisma } from '../../generated/client.js';

import {
  cursorBinding,
  readSearchCursor,
  encodeSearchCursor,
} from './search-cursor.js';

import type { OperationResult } from '@antica/application/ports';
import type {
  KnowledgeTopicsQuery,
  KnowledgeTopicsPage,
  KnowledgeTopicTreeQuery,
  KnowledgeTopicTree,
} from '@antica/contracts';

import type { Transaction } from '../../transaction.js';

import type { KnowledgeContext } from './v2.js';

/**
 * constructs owner-scoped localized topic summaries reusable inside bulk queries
 * @param ownerId authenticated collector
 * @param locale display locale
 * @returns CTE named topic_rows, including original labels and counts
 */
export function topicRowsSql(ownerId: string, locale: string): Prisma.Sql {
  return Prisma.sql`topic_rows AS MATERIALIZED (
    SELECT t.*, jsonb_build_object('id',t.id,'contentId',t.content_id,'facet',t.facet,'parentId',t.parent_id,
      'label',coalesce(label.text,t.content_id),'language',coalesce(label.language,${locale}),'fallback',coalesce(label.language<>${locale},true),
      'sortOrder',t.sort_order,'labels',coalesce(labels.items,'[]'::jsonb),
      'childCount',(SELECT count(*)::int FROM topics child WHERE child.owner_id=t.owner_id AND child.parent_id=t.id AND child.retired_at IS NULL),
      'savedCount',(SELECT count(*)::int FROM knowledge_revision_topics k JOIN knowledge_entries e ON e.id=k.entry_id AND e.owner_id=k.owner_id AND e.latest_saved_revision=k.revision WHERE k.owner_id=t.owner_id AND k.topic_id=t.id)) AS summary
    FROM topics t LEFT JOIN LATERAL (SELECT text,language FROM topic_labels WHERE owner_id=t.owner_id AND topic_id=t.id ORDER BY (language=${locale}) DESC,(kind='preferred') DESC,language,text LIMIT 1) label ON true
    LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('text',text,'language',language,'kind',kind) ORDER BY language,kind,text) items FROM topic_labels WHERE owner_id=t.owner_id AND topic_id=t.id) labels ON true
    WHERE t.owner_id=${ownerId} AND t.retired_at IS NULL)`;
}
/**
 * browses one keyset page of collector taxonomy in editorial order
 * @param tx connection used for exactly one SQL statement
 * @param ownerId authenticated collector
 * @param input validated browse filters
 * @returns localized page or invalid cursor
 */
export async function browseKnowledgeTopics(
  tx: Transaction,
  ownerId: string,
  input: KnowledgeTopicsQuery,
): Promise<OperationResult<KnowledgeTopicsPage>> {
  const { cursor, ...filters } = input;
  const binding = cursorBinding({ ownerId, ...filters });
  const position = readSearchCursor(cursor, binding);
  if (position === false) {
    return invalidCursor();
  }
  const pattern = `%${input.q?.replace(/[\\%_]/g, '\\$&') ?? ''}%`;
  const result = await tx.$queryRaw<
    Array<{ data: unknown }>
  >(Prisma.sql`WITH ${topicRowsSql(ownerId, input.locale)}, selected AS (
    SELECT * FROM topic_rows WHERE ${input.facet ? Prisma.sql`facet::text=${input.facet}` : input.parentId ? Prisma.sql`true` : Prisma.sql`facet='category'`}
    AND ${input.parentId ? Prisma.sql`parent_id=${input.parentId}::uuid` : Prisma.sql`parent_id IS NULL`}
    AND ${input.q ? Prisma.sql`EXISTS (SELECT 1 FROM topic_labels l WHERE l.topic_id=topic_rows.id AND l.owner_id=${ownerId} AND l.text ILIKE ${pattern})` : Prisma.sql`true`}
  ), page AS (SELECT * FROM selected WHERE ${position ? Prisma.sql`(sort_order,id)>(${position.sort},${position.id}::uuid)` : Prisma.sql`true`} ORDER BY sort_order,id LIMIT ${input.limit + 1})
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(summary ORDER BY sort_order,id) FROM page),'[]'::jsonb),'total',(SELECT count(*)::int FROM selected)) AS data`);
  const page = knowledgeTopicsPageSchema.parse({
    ...(result[0]!.data as object),
    nextCursor: null,
  });
  const extra = page.items.length > input.limit;
  const items = page.items.slice(0, input.limit);
  const last = items.at(-1);

  return {
    success: true,
    data: {
      ...page,
      items,
      nextCursor:
        extra && last
          ? encodeSearchCursor({
              binding,
              generation: 'topics',
              lane: 0,
              score: 0,
              support: 0,
              id: last.id,
              key: '',
              sort: last.sortOrder,
            })
          : null,
    },
  };
}
/**
 * loads bounded descendants, ancestors and related labels in one owner-scoped query
 * @param context owner-scoped connection
 * @param id root concept identity
 * @param input validated tree bounds and direct-child continuation
 * @returns localized tree, not-found or invalid cursor
 */
export async function readKnowledgeTopicTree(
  context: KnowledgeContext,
  id: string,
  input: KnowledgeTopicTreeQuery,
): Promise<OperationResult<KnowledgeTopicTree>> {
  const { tx, ownerId } = context;
  const { cursor, ...filters } = input;
  const binding = cursorBinding({ ownerId, id, ...filters });
  const position = readSearchCursor(cursor, binding);
  if (position === false) {
    return invalidCursor();
  }
  const rows = await tx.$queryRaw<
    Array<{ data: unknown }>
  >(Prisma.sql`WITH RECURSIVE ${topicRowsSql(ownerId, input.locale)}, root AS (SELECT * FROM topic_rows WHERE id=${id}::uuid),
    ancestors AS (SELECT t.*,1 AS depth,ARRAY[t.id] AS path FROM topic_rows t JOIN root r ON t.id=r.parent_id
      UNION ALL SELECT t.*,a.depth+1,a.path||t.id FROM topic_rows t JOIN ancestors a ON t.id=a.parent_id WHERE a.depth<32 AND NOT t.id=ANY(a.path)),
    direct AS (SELECT * FROM topic_rows WHERE parent_id=${id}::uuid AND ${position ? Prisma.sql`(sort_order,id)>(${position.sort},${position.id}::uuid)` : Prisma.sql`true`} ORDER BY sort_order,id LIMIT ${input.childrenLimit + 1}),
    descendants AS (SELECT d.*,1 AS depth,ARRAY[d.id] AS path FROM (SELECT * FROM direct ORDER BY sort_order,id LIMIT ${input.childrenLimit}) d
      UNION ALL SELECT child.*,p.depth+1,p.path||child.id FROM descendants p CROSS JOIN LATERAL (SELECT * FROM topic_rows WHERE parent_id=p.id ORDER BY sort_order,id LIMIT ${input.childrenLimit}) child WHERE p.depth<${input.depth} AND NOT child.id=ANY(p.path))
    SELECT CASE WHEN EXISTS(SELECT 1 FROM root) THEN jsonb_build_object('topic',(SELECT summary FROM root),
      'ancestors',coalesce((SELECT jsonb_agg(summary ORDER BY depth DESC) FROM ancestors),'[]'::jsonb),
      'descendants',coalesce((SELECT jsonb_agg(summary||jsonb_build_object('depth',depth,'hasMore',(summary->>'childCount')::int>${input.childrenLimit} OR (depth=${input.depth} AND (summary->>'childCount')::int>0)) ORDER BY depth,sort_order,id) FROM descendants),'[]'::jsonb),
      'related',coalesce((SELECT jsonb_agg(jsonb_build_object('id',t.id,'label',t.summary->>'label','relation',r.relation)) FROM topic_relations r JOIN topic_rows t ON t.id=CASE WHEN r.from_topic_id=${id}::uuid THEN r.to_topic_id ELSE r.from_topic_id END WHERE r.owner_id=${ownerId} AND (r.from_topic_id=${id}::uuid OR r.to_topic_id=${id}::uuid)),'[]'::jsonb),
      'more',(SELECT count(*)>${input.childrenLimit} FROM direct)) ELSE NULL END AS data`);
  if (!rows[0]!.data) {
    return {
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Topic not found',
        retryable: false,
      },
    };
  }
  const raw = rows[0]!.data as { more: boolean };
  const { more, ...data } = raw;
  const tree = knowledgeTopicTreeSchema.parse({ ...data, nextCursor: null });
  const last = tree.descendants.filter((topic) => topic.depth === 1).at(-1);

  return {
    success: true,
    data: {
      ...tree,
      nextCursor:
        more && last
          ? encodeSearchCursor({
              binding,
              generation: 'topics',
              lane: 0,
              score: 0,
              support: 0,
              id: last.id,
              key: '',
              sort: last.sortOrder,
            })
          : null,
    },
  };
}
/**
 * constructs an actionable malformed or mismatched continuation error
 * @returns stable public cursor validation error
 */
function invalidCursor(): OperationResult<never> {
  return {
    success: false,
    error: {
      code: 'VALIDATION_FAILED',
      message: 'Invalid or mismatched topic cursor',
      retryable: false,
      field: 'cursor',
    },
  };
}
