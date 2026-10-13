import { createHash, randomUUID } from 'node:crypto';

import { validateIndexSpace } from './index-space.js';

import type {
  IndexIdentity,
  TextRetrievalPort,
} from '@antica/application/ports';
import type { KnowledgeSummary } from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

/** stores original text separately from its searchable knowledge summary */
export interface TextSearchEntry {
  readonly summary: KnowledgeSummary;
  readonly citation: SourceCitation;
  readonly contentAsRetrieved: string;
  readonly sourceRegionId: string | null;
}

/** provides authorized persisted text entries */
export interface LocalTextRetrievalParams {
  readonly index: IndexIdentity;
  readonly readEntries: () => Promise<readonly TextSearchEntry[]>;
}

/** records that this index uses lexical overlap rather than generated vectors */
export const developmentTextIndex: IndexIdentity = {
  embeddingModelId: 'development:lexical-v1',
  dimensions: 1,
  indexVersion: 'lexical-v1',
};

/**
 * retrieves real stored text with deterministic lexical ranking
 * @param params authorized text reader and index identity
 * @returns text retrieval port
 */
export function createLocalTextRetrieval(
  params: LocalTextRetrievalParams,
): TextRetrievalPort {
  return {
    search: async (query, index) => {
      if (
        !validateIndexSpace(params.index, index).valid ||
        !validateIndexSpace(developmentTextIndex, params.index).valid
      ) {
        return {
          success: false,
          error: {
            code: 'INDEX_NOT_READY',
            message:
              'The lexical query and stored index identities do not match.',
            retryable: false,
          },
        };
      }
      const fingerprint = createHash('sha256')
        .update(JSON.stringify({ ...query, cursor: undefined, index }))
        .digest('hex');
      const pageOffset = query.cursor
        ? decodeCursor(query.cursor, fingerprint)
        : 0;
      if (pageOffset === null) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'The search cursor does not match this query.',
            retryable: false,
          },
        };
      }
      const unsupportedFilters = [
        query.filters?.materialIds,
        query.filters?.objectTypeIds,
        query.filters?.periodIds,
        query.filters?.regionIds,
      ].some((ids) => ids && ids.length > 0);
      if (unsupportedFilters) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message:
              'This local lexical index has no material, object type, period, or region classification.',
            retryable: false,
          },
        };
      }
      try {
        const entries = rankText(
          await params.readEntries(),
          query.q ?? '',
        ).filter(
          (entry) =>
            (!query.kinds?.length ||
              entry.summary.kinds.some((kind) =>
                query.kinds?.includes(kind),
              )) &&
            (!query.status || entry.summary.status === query.status) &&
            (!query.filters?.sourceIds?.length ||
              query.filters.sourceIds.includes(
                entry.citation.locator.sourceId,
              )),
        );
        const unique = [
          ...new Map(
            entries.map((entry) => [entry.summary.id, entry.summary]),
          ).values(),
        ];
        const limit = Math.min(query.limit ?? 30, 100);
        const items = unique.slice(pageOffset, pageOffset + limit);
        const nextCursor =
          pageOffset + limit < unique.length
            ? Buffer.from(
                JSON.stringify({ offset: pageOffset + limit, fingerprint }),
              ).toString('base64url')
            : null;

        return { success: true, data: { items, nextCursor } };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'Stored text could not be read.',
            retryable: true,
          },
          cause,
        };
      }
    },
    snapshot: async (query, index) => {
      if (
        !validateIndexSpace(params.index, index).valid ||
        !validateIndexSpace(developmentTextIndex, params.index).valid
      ) {
        return {
          success: false,
          error: {
            code: 'INDEX_NOT_READY',
            message:
              'The lexical query and stored index identities do not match.',
            retryable: false,
          },
        };
      }
      try {
        const entries = rankText(await params.readEntries(), query).slice(
          0,
          30,
        );

        return {
          success: true,
          data: {
            id: randomUUID(),
            index,
            citations: entries.map((entry) => entry.citation),
            text: entries.map((entry) => ({
              citationId: entry.citation.id,
              contentAsRetrieved: entry.contentAsRetrieved,
              sourceRegionId: entry.sourceRegionId,
            })),
            methods: [],
            createdAt: new Date().toISOString(),
          },
        };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'SOURCE_UNAVAILABLE',
            message: 'Stored source evidence could not be read.',
            retryable: true,
          },
          cause,
        };
      }
    },
  };
}

/**
 * ranks located source text by deterministic lexical overlap
 * @param entries authorized persisted source entries
 * @param query collector search text
 * @returns ranked entries retaining their original source content
 */
function rankText(
  entries: readonly TextSearchEntry[],
  query: string,
): readonly TextSearchEntry[] {
  const queryTokens = tokenize(query);

  return entries
    .filter(
      (entry) =>
        entry.citation.availability !== 'unavailable' &&
        entry.citation.verification === 'located',
    )
    .map((entry) => {
      const words = tokenize(
        `${entry.summary.titleZhHant} ${entry.contentAsRetrieved}`,
      );

      return {
        entry,
        score: [...queryTokens].filter((token) => words.has(token)).length,
      };
    })
    .filter((item) => queryTokens.size === 0 || item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.entry.summary.id.localeCompare(right.entry.summary.id),
    )
    .map((item) => item.entry);
}

/**
 * normalizes search terms while retaining individual Han characters
 * @param text query or searchable source text
 * @returns distinct lexical tokens
 */
function tokenize(text: string): ReadonlySet<string> {
  return new Set(
    text
      .normalize('NFKC')
      .toLocaleLowerCase('zh-Hant')
      .match(/\p{Script=Han}|[\p{L}\p{N}]+/gu) ?? [],
  );
}

/**
 * checks a text cursor against its frozen query identity
 * @param cursor opaque encoded pagination cursor
 * @param fingerprint expected query and index fingerprint
 * @returns valid offset or null
 */
function decodeCursor(cursor: string, fingerprint: string): number | null {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      typeof value !== 'object' ||
      value === null ||
      !('fingerprint' in value) ||
      value.fingerprint !== fingerprint ||
      !('offset' in value) ||
      typeof value.offset !== 'number' ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0
    ) {
      return null;
    }

    return value.offset;
  } catch {
    return null;
  }
}
