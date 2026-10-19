import { recordHistoryPageSchema } from '@antica/contracts';

import type {
  InfiniteData,
  UseInfiniteQueryOptions,
} from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { RecordHistoryPage, RecordHistorySource } from '@antica/contracts';

/** entries fetched per page of a record's change history */
export const recordHistoryPageSize = 20;

/**
 * names a record's change history beneath the record's own query key, so every
 * invalidation of `['record', recordId]` (for example after an analysis apply) refreshes it too
 * @param recordId record whose history is read
 * @returns query key nested under the record query key
 */
export function recordHistoryKey(recordId: string): readonly string[] {
  return ['record', recordId, 'history'];
}

/**
 * describes the record's change history, newest first, with older pages read through `nextCursor`
 * @param api authenticated API transport
 * @param recordId record whose history is read
 * @returns infinite query options whose next page holds older entries
 */
export function recordHistoryQuery(
  api: ApiTransport,
  recordId: string,
): UseInfiniteQueryOptions<
  RecordHistoryPage,
  Error,
  InfiniteData<RecordHistoryPage, string | null>,
  readonly string[],
  string | null
> {
  return {
    queryKey: recordHistoryKey(recordId),
    initialPageParam: null,
    queryFn: async ({ pageParam, signal }) => {
      const query = new URLSearchParams({
        limit: String(recordHistoryPageSize),
      });
      if (pageParam) {
        query.set('cursor', pageParam);
      }

      return api.get(
        `/v1/records/${encodeURIComponent(recordId)}/history?${query.toString()}`,
        recordHistoryPageSchema,
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor,
  };
}

/**
 * finds the screen that shows the suggestion behind a history entry
 * @param recordId record the history belongs to
 * @param source the analysis run or edit draft that proposed the change
 * @returns route of that suggestion, or null when it has no screen
 */
export function historySourceRoute(
  recordId: string,
  source: RecordHistorySource,
): string | null {
  if (source.kind === 'analysis') {
    return `/analysis/${encodeURIComponent(source.runId)}?proposalId=${encodeURIComponent(source.proposalId)}`;
  }

  // a draft requested by voice alone has no message to show
  return source.recordMessageId
    ? `/collection/${encodeURIComponent(recordId)}/messages?messageId=${encodeURIComponent(source.recordMessageId)}`
    : null;
}
