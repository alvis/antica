import { useQuery } from '@tanstack/react-query';

import { knowledgeSearchPageSchema } from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { knowledgeSearchPath } from '../../knowledge/api/knowledge';

import type { UseQueryResult } from '@tanstack/react-query';

import type { KnowledgeSearchPage } from '@antica/contracts';

/** the few best saved matches an answer quotes */
const answerSize = 3;

/**
 * searches the saved knowledge base for a suggested question, through the existing search API
 * @param query words to search, or null while no knowledge question is chosen
 * @returns the search page whose cited excerpts form the answer
 */
export function useAskKnowledgeAnswer(
  query: string | null,
): UseQueryResult<KnowledgeSearchPage> {
  const { api, userId } = useAuth();
  const { locale } = useLocale();

  return useQuery({
    queryKey: ['ask-knowledge', userId, locale, query],
    enabled: query !== null,
    retry: false,
    queryFn: async ({ signal }) =>
      api.get(
        knowledgeSearchPath({
          q: query ?? '',
          view: 'saved',
          locale,
          limit: answerSize,
        }),
        knowledgeSearchPageSchema,
        signal,
      ),
  });
}
