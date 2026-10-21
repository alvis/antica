import { useQuery } from '@tanstack/react-query';

import { relatedKnowledgePageSchema } from '@antica/contracts';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { UseQueryResult } from '@tanstack/react-query';

import type { RelatedKnowledgePage } from '@antica/contracts';

/**
 * reads the owner-scoped saved entries related to a visible record revision
 * @param recordId record identity; nothing is read without one
 * @param recordRevision optional shown revision
 * @returns query state of the record's related cards
 */
export function useRelatedKnowledge(
  recordId: string | undefined,
  recordRevision: number | undefined,
): UseQueryResult<RelatedKnowledgePage, Error> {
  const { api, userId } = useAuth();
  const { locale } = useLocale();

  return useQuery({
    queryKey: [
      'record-related-knowledge',
      userId,
      recordId,
      recordRevision,
      locale,
    ],
    enabled: recordId !== undefined,
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams({ locale, limit: '3' });
      if (recordRevision !== undefined) {
        parameters.set('recordRevision', String(recordRevision));
      }

      return api.get(
        `/v1/records/${encodeURIComponent(recordId ?? '')}/related-knowledge?${parameters}`,
        relatedKnowledgePageSchema,
        signal,
      );
    },
    retry: false,
  });
}
