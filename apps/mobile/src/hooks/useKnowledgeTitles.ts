import { useQueries } from '@tanstack/react-query';

import { knowledgeDetailSchema } from '@antica/contracts';

import { useAuth } from '../providers/AuthProvider';
import { useLocale } from '../providers/LocaleProvider';

/**
 * reads the titles of knowledge entries, such as object types and materials
 * @param ids knowledge entries to name; repeats are read once
 * @returns the title, a loading placeholder, or a localized unavailable label
 */
export function useKnowledgeTitles(
  ids: readonly string[],
): (id: string) => string {
  const { api } = useAuth();
  const { t } = useLocale();
  const uniqueIds = [...new Set(ids)];
  const knowledge = useQueries({
    queries: uniqueIds.map((id) => ({
      queryKey: ['knowledge-detail', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        api.get(`/v1/knowledge/${id}`, knowledgeDetailSchema, signal),
    })),
  });
  const titles = new Map(
    knowledge.map((item, index) => [
      uniqueIds[index],
      item.data?.entry.content.titleZhHant ??
        t(item.isError ? 'unknown' : 'loading'),
    ]),
  );

  return (id) => titles.get(id) ?? t('unknown');
}
