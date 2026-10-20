import { useQueries, useInfiniteQuery } from '@tanstack/react-query';

import {
  knowledgeFacetSchema,
  knowledgeTopicsPageSchema,
  knowledgeTopicTreeSchema,
} from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type {
  InfiniteData,
  UseInfiniteQueryResult,
  UseQueryResult,
  QueryFunctionContext,
} from '@tanstack/react-query';

import type { KnowledgeTopicSummary } from '@antica/contracts';

interface KnowledgeTopicsState {
  groups: Array<UseQueryResult<KnowledgeTopicSummary[], Error>>;
  tree: UseInfiniteQueryResult<
    InfiniteData<ReturnType<typeof knowledgeTopicTreeSchema.parse>>,
    Error
  >;
}

/**
 * loads bounded topic pages and an independently paginated direct-child path
 * @param topicId current topic path, absent at category roots
 * @param filtersOpen whether facet option lists are visible
 * @returns root/facet queries and direct-child continuation
 */
export function useKnowledgeTopics(
  topicId: string | null,
  filtersOpen: boolean,
): KnowledgeTopicsState {
  const { api, userId } = useAuth();
  const { locale } = useLocale();
  const groups = useQueries({
    queries: knowledgeFacetSchema.options.map((facet) => ({
      queryKey: ['knowledge-topics', userId, locale, facet],
      enabled: facet === 'category' || filtersOpen,
      queryFn: async ({ signal }: QueryFunctionContext) => {
        const items: KnowledgeTopicSummary[] = [];
        let cursor: string | null = null;
        do {
          const parameters = new URLSearchParams({
            locale,
            facet,
            limit: '100',
          });
          if (cursor) {
            parameters.set('cursor', cursor);
          }
          const page = await api.get(
            `/v1/knowledge/topics?${parameters}`,
            knowledgeTopicsPageSchema,
            signal,
          );
          items.push(...page.items);
          cursor = page.nextCursor;
        } while (cursor);

        return items;
      },
    })),
  });
  const tree = useInfiniteQuery({
    queryKey: ['knowledge-tree', userId, locale, topicId],
    enabled: Boolean(topicId),
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const parameters = new URLSearchParams({
        locale,
        depth: '1',
        childrenLimit: '100',
      });
      if (pageParam) {
        parameters.set('cursor', pageParam);
      }

      return api.get(
        `/v1/knowledge/topics/${topicId}/tree?${parameters}`,
        knowledgeTopicTreeSchema,
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor,
  });

  return { groups, tree };
}
