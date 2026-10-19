import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { useEffect, useState } from 'react';

import { knowledgeSearchPageSchema } from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { knowledgeSearchPath } from '../api/knowledge';

import type {
  InfiniteData,
  UseInfiniteQueryResult,
} from '@tanstack/react-query';

import type {
  KnowledgeSearchPage,
  KnowledgeSearchQuery,
} from '@antica/contracts';

const debounceMs = 300;

/** the reader's visible search choices; pagination is owned by the hook */
export type KnowledgeSearchSelection = Omit<
  KnowledgeSearchQuery,
  'q' | 'locale' | 'limit' | 'cursor'
> & { query: string };

/**
 * debounces text and cancels obsolete reads while retaining visible results
 * @param selection reader-selected query and facet groups
 * @returns infinite discovery state and cursor actions
 */
export function useKnowledgeSearch(
  selection: KnowledgeSearchSelection,
): UseInfiniteQueryResult<InfiniteData<KnowledgeSearchPage>, Error> {
  const { api, userId } = useAuth();
  const { locale } = useLocale();
  const client = useQueryClient();
  const [settled, setSettled] = useState(selection.query);
  useEffect(() => {
    if (selection.query === settled) {
      return undefined;
    }
    void client.cancelQueries({ queryKey: ['knowledge-search', userId] });
    const timer = setTimeout(() => setSettled(selection.query), debounceMs);

    return () => clearTimeout(timer);
  }, [client, selection.query, settled, userId]);
  const { query: _query, ...filters } = selection;

  return useInfiniteQuery({
    queryKey: ['knowledge-search', userId, locale, settled, filters],
    initialPageParam: null as string | null,
    placeholderData: keepPreviousData,
    enabled: selection.query === settled,
    queryFn: async ({ pageParam, signal }) =>
      api.get(
        knowledgeSearchPath({
          ...filters,
          q: settled,
          locale,
          limit: 20,
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
        knowledgeSearchPageSchema,
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });
}
