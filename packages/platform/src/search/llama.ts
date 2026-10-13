import { createHash, randomUUID } from 'node:crypto';

import LlamaCloud from '@llamaindex/llama-cloud';

import { validateIndexSpace } from './index-space.js';

import type {
  IndexIdentity,
  OperationResult,
  TextRetrievalPort,
} from '@antica/application/ports';

import type { TextSearchEntry } from './text.js';

/** identifies provider chunks without promoting them to canonical source locators */
export interface LlamaRetrievedChunk {
  readonly fileId: string;
  readonly chunkIndex: number;
  readonly contentAsRetrieved: string;
}
/** resolves provider chunks through an authorized durable canonical-source mapping */
export interface LlamaTextRetrievalParams {
  readonly ownerId: string;
  readonly apiKey?: string;
  readonly indexId: string;
  readonly index: IndexIdentity;
  readonly resolveChunk: (
    chunk: LlamaRetrievedChunk,
  ) => Promise<TextSearchEntry | null>;
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * retrieves actual LlamaCloud chunks and binds them to retained canonical citations
 * @param params configured index, provider credential, and authorized chunk mapping
 * @returns text retrieval adapter with explicit mapping and index failures
 */
export function createLlamaTextRetrieval(
  params: LlamaTextRetrievalParams,
): TextRetrievalPort {
  async function retrieve(
    query: string,
    index: IndexIdentity,
  ): Promise<OperationResult<readonly TextSearchEntry[]>> {
    if (!validateIndexSpace(params.index, index).valid) {
      return {
        success: false,
        error: {
          code: 'INDEX_NOT_READY',
          message:
            'The LlamaCloud index identity does not match the requested embedding space.',
          retryable: false,
        },
      };
    }
    if (
      !params.apiKey?.trim() ||
      !params.indexId.trim() ||
      !params.ownerId.trim()
    ) {
      return {
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message:
            'LlamaCloud retrieval requires a credential and explicit index ID.',
          retryable: false,
        },
      };
    }
    try {
      const client = new LlamaCloud({
        apiKey: params.apiKey,
        maxRetries: 0,
        timeout: 30_000,
        logLevel: 'off',
        fetch: params.fetch,
      });
      const result = await client.retrieval.retrieve({
        index_id: params.indexId,
        query,
        custom_filters: {
          anticaOwnerId: { operator: 'eq', value: params.ownerId },
        },
        top_k: 100,
      });
      const entries: TextSearchEntry[] = [];
      for (const item of result.results) {
        if (
          item.metadata?.anticaOwnerId !== params.ownerId ||
          item.metadata.anticaIndexVersion !== params.index.indexVersion
        ) {
          return mappingFailure();
        }
        if (!item.content.trim()) {
          continue;
        }
        const fileId = item.static_fields?.parsed_directory_file_id;
        const chunkIndex = item.static_fields?.chunk_index;
        if (
          !fileId ||
          chunkIndex === undefined ||
          chunkIndex === null ||
          !Number.isSafeInteger(chunkIndex) ||
          chunkIndex < 0
        ) {
          return mappingFailure();
        }
        const entry = await params.resolveChunk({
          fileId,
          chunkIndex,
          contentAsRetrieved: item.content,
        });
        if (
          !entry ||
          entry.contentAsRetrieved !== item.content ||
          entry.citation.verification !== 'located' ||
          entry.citation.availability === 'unavailable'
        ) {
          return mappingFailure();
        }
        entries.push(entry);
      }

      return { success: true, data: entries };
    } catch (cause) {
      return {
        success: false,
        error: {
          code: 'SOURCE_UNAVAILABLE',
          message: 'LlamaCloud source evidence could not be retrieved.',
          retryable: true,
        },
        cause,
      };
    }
  }

  return {
    search: async (query, index) => {
      if (
        [
          query.filters?.materialIds,
          query.filters?.objectTypeIds,
          query.filters?.periodIds,
          query.filters?.regionIds,
        ].some((ids) => ids?.length)
      ) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message:
              'This text index has no material, object type, period, or region classification.',
            retryable: false,
          },
        };
      }
      const result = await retrieve(query.q ?? '', index);
      if (!result.success) {
        return result;
      }
      const entries = result.data.filter(
        (entry) =>
          (!query.kinds?.length ||
            entry.summary.kinds.some((kind) => query.kinds?.includes(kind))) &&
          (!query.status || entry.summary.status === query.status) &&
          (!query.filters?.sourceIds?.length ||
            query.filters.sourceIds.includes(entry.citation.locator.sourceId)),
      );
      const items = [
        ...new Map(
          entries.map((entry) => [entry.summary.id, entry.summary]),
        ).values(),
      ];
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            query: { ...query, cursor: undefined },
            index,
            ids: items.map((item) => item.id),
          }),
        )
        .digest('hex');
      const offset = query.cursor ? decodeCursor(query.cursor, fingerprint) : 0;
      if (offset === null) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message:
              'The text-search cursor is invalid or the result order has changed.',
            retryable: false,
          },
        };
      }
      const limit = Math.min(query.limit ?? 30, 100);

      return {
        success: true,
        data: {
          items: items.slice(offset, offset + limit),
          nextCursor:
            offset + limit < items.length
              ? Buffer.from(
                  JSON.stringify({ offset: offset + limit, fingerprint }),
                ).toString('base64url')
              : null,
        },
      };
    },
    snapshot: async (query, index) => {
      const result = await retrieve(query, index);
      if (!result.success) {
        return result;
      }
      const entries = [
        ...new Map(
          result.data.map((entry) => [entry.citation.id, entry]),
        ).values(),
      ].slice(0, 30);

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
    },
  };
}

/**
 * rejects provider content without a retained canonical source mapping
 * @returns non-retryable source failure
 */
function mappingFailure(): OperationResult<never> {
  return {
    success: false,
    error: {
      code: 'SOURCE_UNAVAILABLE',
      message:
        'A retrieved provider chunk has no exact retained canonical source mapping.',
      retryable: false,
    },
  };
}

/**
 * checks a retrieval cursor against the current result identities
 * @param cursor opaque encoded pagination cursor
 * @param fingerprint expected query and result fingerprint
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
