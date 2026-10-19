import {
  knowledgeSearchQuerySchema,
  knowledgeSearchPageSchema,
} from '@antica/contracts';

import { tokenizerVersion } from '../../../search/text/tokenizer.js';

import {
  cursorBinding,
  readSearchCursor,
  encodeSearchCursor,
} from './search-cursor.js';
import { readKnowledgeDetail } from './search-detail.js';
import { readRelatedKnowledge } from './search-related.js';
import { knowledgeSearchSql } from './search-sql.js';
import {
  browseKnowledgeTopics,
  readKnowledgeTopicTree,
} from './search-topics.js';

import type {
  OperationResult,
  KnowledgeDiscovery,
} from '@antica/application/ports';
import type {
  KnowledgeSearchQuery,
  KnowledgeSearchPage,
  RelatedKnowledgeDiscovery,
} from '@antica/contracts';

import type { Transaction } from '../../transaction.js';

/** explicit lexical capability; never silently changed after query failure */
export type KnowledgeSearchMode = 'postgres' | 'degraded';
/** owner-scoped bulk discovery capabilities */
export interface KnowledgeSearchRepository {
  search(
    input: KnowledgeSearchQuery,
  ): Promise<OperationResult<KnowledgeSearchPage>>;
  topics: (
    input: Parameters<KnowledgeDiscovery['topics']>[1],
  ) => ReturnType<KnowledgeDiscovery['topics']>;
  tree: (
    id: string,
    input: Parameters<KnowledgeDiscovery['tree']>[2],
  ) => ReturnType<KnowledgeDiscovery['tree']>;
}
interface RankedPosition {
  readonly id: string;
  readonly key: string;
  readonly lane: number;
  readonly score: number;
  readonly support: number;
}

/**
 * selects the explicitly configured mode, refusing unsupported configuration
 * @param value deployment capability selection
 * @returns selected lexical capability
 */
export function knowledgeSearchMode(
  value = process.env.ANTICA_KNOWLEDGE_SEARCH_MODE ?? 'postgres',
): KnowledgeSearchMode {
  if (value !== 'postgres' && value !== 'degraded') {
    throw new TypeError(
      'ANTICA_KNOWLEDGE_SEARCH_MODE must be postgres or degraded',
    );
  }

  return value;
}
/**
 * binds one owner to single-statement search and taxonomy reads
 * @param tx connection or caller-owned transaction
 * @param ownerId authenticated collector, never taken from filters
 * @param mode startup-selected capability
 * @returns bulk discovery operations
 */
export function createKnowledgeSearchRepository(
  tx: Transaction,
  ownerId: string,
  mode: KnowledgeSearchMode = knowledgeSearchMode(),
): KnowledgeSearchRepository {
  return {
    search: async (input) => searchKnowledge({ tx, ownerId, mode }, input),
    topics: async (input) => browseKnowledgeTopics(tx, ownerId, input),
    tree: async (id, input) =>
      readKnowledgeTopicTree({ tx, ownerId }, id, input),
  };
}
/**
 * composes direct read capabilities without BEGIN/COMMIT overhead
 * @param tx application database connection
 * @param mode explicit startup capability
 * @returns authenticated search, taxonomy and bulk pinned detail reads
 */
export function createKnowledgeDiscovery(
  tx: Transaction,
  mode: KnowledgeSearchMode = knowledgeSearchMode(),
): KnowledgeDiscovery & RelatedKnowledgeDiscovery {
  return {
    search: async (ownerId, input) =>
      searchKnowledge({ tx, ownerId, mode }, input),
    topics: async (ownerId, input) => browseKnowledgeTopics(tx, ownerId, input),
    tree: async (ownerId, id, input) =>
      readKnowledgeTopicTree({ tx, ownerId }, id, input),
    related: async (ownerId, id, input) =>
      readRelatedKnowledge({ tx, ownerId }, id, input),
    detail: async (ownerId, id, input) =>
      readKnowledgeDetail({ tx, ownerId }, id, input),
  };
}
/**
 * ranks, filters, counts and pages the owner corpus under one SQL snapshot
 * @param context owner-scoped connection and explicit capability
 * @param supplied bounded query and facet filters
 * @returns pinned hits, self-excluding facets and generation-bound continuation
 */
async function searchKnowledge(
  context: SearchContext,
  supplied: KnowledgeSearchQuery,
): Promise<OperationResult<KnowledgeSearchPage>> {
  const { tx, ownerId, mode } = context;
  const input = knowledgeSearchQuerySchema.parse(supplied);
  const binding = searchBinding(ownerId, input, mode);
  const position = readSearchCursor(input.cursor, binding);
  if (position === false) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Invalid or mismatched search cursor',
        retryable: false,
        field: 'cursor',
      },
    };
  }
  const rows = await tx.$queryRaw<Array<{ data: unknown }>>(
    knowledgeSearchSql(ownerId, input, { mode, position }),
  );
  const raw = rows[0]!.data as {
    positions: RankedPosition[];
    corpusGeneration: string;
  };
  if (position && position.generation !== raw.corpusGeneration) {
    return {
      success: false,
      error: {
        code: 'SEARCH_CURSOR_EXPIRED',
        message: 'Knowledge corpus changed; restart search',
        retryable: false,
        field: 'cursor',
      },
    };
  }

  return searchPage({ raw, binding, mode }, input.limit);
}

/**
 * validates the database payload and emits a bounded continuation
 * @param context snapshot and cursor identity
 * @param limit requested page size
 * @returns validated pinned search page
 */
function searchPage(
  context: SearchPageContext,
  limit: number,
): OperationResult<KnowledgeSearchPage> {
  const { raw, binding, mode } = context;
  const { positions, ...data } = raw;
  const parsed = knowledgeSearchPageSchema.parse({
    ...data,
    nextCursor: null,
    diagnostics: { mode, tokenizerVersion },
  });
  const hits = parsed.hits.slice(0, limit);
  const last = positions[limit - 1];

  return {
    success: true,
    data: {
      ...parsed,
      hits,
      nextCursor:
        parsed.hits.length > limit && last
          ? encodeSearchCursor({
              ...last,
              binding,
              generation: parsed.corpusGeneration,
              sort: 0,
            })
          : null,
    },
  };
}

/**
 * canonicalizes unordered filters before binding a continuation
 * @param ownerId authenticated owner
 * @param input validated search query
 * @param mode explicit lexical capability
 * @returns stable context digest
 */
function searchBinding(
  ownerId: string,
  input: KnowledgeSearchQuery,
  mode: KnowledgeSearchMode,
): string {
  const { cursor: _cursor, ...filters } = input;
  const canonical = {
    ...filters,
    topics: Object.fromEntries(
      Object.entries(input.topics ?? {})
        .sort()
        .map(([facet, ids]) => [facet, [...new Set(ids)].sort()]),
    ),
    providers: [...new Set(input.providers ?? [])].sort(),
    languages: [...new Set(input.languages ?? [])].sort(),
    entryTypes: [...new Set(input.entryTypes ?? [])].sort(),
  };

  return cursorBinding({
    ownerId,
    filters: canonical,
    tokenizerVersion,
    mode,
  });
}

interface SearchContext {
  readonly tx: Transaction;
  readonly ownerId: string;
  readonly mode: KnowledgeSearchMode;
}
interface SearchSnapshot {
  readonly positions: RankedPosition[];
  readonly corpusGeneration: string;
}
interface SearchPageContext {
  readonly raw: SearchSnapshot;
  readonly binding: string;
  readonly mode: KnowledgeSearchMode;
}
