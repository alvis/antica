import { useInfiniteQuery } from '@tanstack/react-query';

import { useEffect, useMemo, useState } from 'react';

import {
  isPendingEntry,
  recordMessagesQuery,
  stillWorkingAfterMs,
} from '../api/record-messages';

import type { ApiTransport } from '@antica/client';
import type { RecordMessageEntry } from '@antica/contracts';

/** the record's conversation as loaded so far, with its paging and waiting state */
export interface RecordMessageThread {
  /** every loaded message, oldest first */
  entries: RecordMessageEntry[];
  loading: boolean;
  error: Error | null;
  retry: () => void;
  /** whether older messages remain on the server */
  hasOlder: boolean;
  loadingOlder: boolean;
  /** loads the next older page; absent when none remains or one is loading */
  loadOlder?: () => void;
  /** messages whose reply has been pending long enough to reassure the collector */
  stillWorkingIds: ReadonlySet<string>;
}

/**
 * follows a record's conversation, loading older pages on demand and polling while a reply is pending
 * @param api authenticated API transport
 * @param recordId record the conversation belongs to
 * @returns loaded messages, paging actions, and whether a reply is taking long
 */
export function useRecordMessageThread(
  api: ApiTransport,
  recordId: string,
): RecordMessageThread {
  const query = useInfiniteQuery(recordMessagesQuery(api, recordId));
  const entries = useMemo(
    () =>
      [...(query.data?.pages ?? [])].reverse().flatMap((page) => page.items),
    [query.data],
  );
  const [now, setNow] = useState(() => Date.now());
  const pendingSince = entries
    .filter(isPendingEntry)
    .map((entry) => ({ id: entry.id, at: Date.parse(entry.createdAt) }));
  const stillWorkingIds = new Set(
    pendingSince
      .filter(({ at }) => now - at >= stillWorkingAfterMs)
      .map(({ id }) => id),
  );
  // the next moment a pending reply crosses the threshold, timed from when its message was stored
  const nextDeadline = Math.min(
    ...pendingSince
      .map(({ at }) => at + stillWorkingAfterMs)
      .filter((deadline) => deadline > now),
  );

  useEffect(() => {
    if (!Number.isFinite(nextDeadline)) {
      return;
    }
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.max(0, nextDeadline - Date.now()),
    );

    return () => clearTimeout(timer);
  }, [nextDeadline]);

  return {
    entries,
    loading: query.isPending,
    error: query.error,
    retry: () => void query.refetch(),
    hasOlder: query.hasNextPage,
    loadingOlder: query.isFetchingNextPage,
    loadOlder:
      query.hasNextPage && !query.isFetchingNextPage
        ? () => void query.fetchNextPage()
        : undefined,
    stillWorkingIds,
  };
}
