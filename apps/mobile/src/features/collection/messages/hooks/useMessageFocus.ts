import { useEffect, useRef } from 'react';

import type { RefObject } from 'react';
import type { FlatList } from 'react-native';

import type { RecordMessageEntry } from '@antica/contracts';

/** where the list stands while opening a message named by a deep link */
export interface MessageFocus {
  listRef: RefObject<FlatList<RecordMessageEntry> | null>;
  /** scrolls near a message the list has not measured yet */
  onScrollToIndexFailed: (info: {
    index: number;
    averageItemLength: number;
  }) => void;
}

/**
 * scrolls the thread to a message opened from the record's change history, once its first page has loaded;
 * a message beyond that page is not paged to, and the newest messages stay in view
 * @param messageId message named by the deep link, if any
 * @param entries the shown messages in list order
 * @returns the list handle and its fallback for unmeasured rows
 */
export function useMessageFocus(
  messageId: string | undefined,
  entries: readonly RecordMessageEntry[],
): MessageFocus {
  const listRef = useRef<FlatList<RecordMessageEntry>>(null);
  const decided = useRef(false);
  const index = entries.findIndex((entry) => entry.id === messageId);

  useEffect(() => {
    if (decided.current || !messageId || entries.length === 0) {
      return;
    }
    decided.current = true;
    if (index >= 0) {
      listRef.current?.scrollToIndex({
        index,
        animated: false,
        viewPosition: 0.5,
      });
    }
  }, [messageId, entries.length, index]);

  return {
    listRef,
    onScrollToIndexFailed: ({ index: failed, averageItemLength }) => {
      listRef.current?.scrollToOffset({
        offset: failed * averageItemLength,
        animated: false,
      });
    },
  };
}
