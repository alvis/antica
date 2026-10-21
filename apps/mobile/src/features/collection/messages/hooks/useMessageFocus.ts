import { useEffect, useRef } from 'react';

import type { RefObject } from 'react';
import type { FlatList } from 'react-native';

/** where the list stands while opening a message named by a deep link */
export interface MessageFocus<Row extends { id: string }> {
  listRef: RefObject<FlatList<Row> | null>;
  /** moves near a message the list has not measured yet, then tries the exact position again */
  onScrollToIndexFailed: (info: {
    index: number;
    averageItemLength: number;
  }) => void;
}

/** attempts to reach the exact position before settling on the estimate */
const maxRetries = 10;

/** pause that lets the list measure the rows it just rendered */
const retryDelayMs = 50;

/**
 * scrolls the thread to a message opened from the record's change history, once its first page has loaded;
 * a message beyond that page is not paged to, and the newest messages stay in view
 * @param messageId message named by the deep link, if any
 * @param entries the shown messages in list order, newest first for the inverted list
 * @returns the list handle and its fallback for unmeasured rows
 */
export function useMessageFocus<Row extends { id: string }>(
  messageId: string | undefined,
  entries: readonly Row[],
): MessageFocus<Row> {
  const listRef = useRef<FlatList<Row>>(null);
  const decided = useRef(false);
  const retries = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const index = entries.findIndex((entry) => entry.id === messageId);

  /**
   * places a row's far edge on the viewport's far edge; in the inverted list that is the top,
   * so the message sits fully in view with its reply and edit card below it
   * @param target row index in list order
   */
  const scrollTo = (target: number): void => {
    listRef.current?.scrollToIndex({
      index: target,
      animated: false,
      viewPosition: 1,
    });
  };

  useEffect(() => {
    if (decided.current || !messageId || entries.length === 0) {
      return;
    }
    decided.current = true;
    if (index >= 0) {
      scrollTo(index);
    }
  }, [messageId, entries.length, index]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  return {
    listRef,
    onScrollToIndexFailed: ({ index: failed, averageItemLength }) => {
      // the rows are not measured yet: move near the target so they render, then retry once laid out
      listRef.current?.scrollToOffset({
        offset: failed * averageItemLength,
        animated: false,
      });
      if (retries.current >= maxRetries) {
        return;
      }
      retries.current += 1;
      clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => scrollTo(failed), retryDelayMs);
    },
  };
}
