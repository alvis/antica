import { useQueries } from '@tanstack/react-query';

import { knowledgeDetailSchema } from '@antica/contracts';

import { useAuth } from '../providers/AuthProvider';
import { shortId } from '../utils/short-id';

/**
 * reads the titles of knowledge entries, such as object types and materials
 * @param ids knowledge entries to name; repeats are read once
 * @returns the title of an entry, or a short identifier until it is read
 */
export function useKnowledgeTitles(
  ids: readonly string[],
): (id: string) => string {
  const { api } = useAuth();
  const knowledge = useQueries({
    queries: [...new Set(ids)].map((id) => ({
      queryKey: ['knowledge-detail', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        api.get(`/v1/knowledge/${id}`, knowledgeDetailSchema, signal),
    })),
  });
  const titles = new Map(
    knowledge.flatMap((item) =>
      item.data
        ? [[item.data.entry.id, item.data.entry.content.titleZhHant]]
        : [],
    ),
  );

  return (id) => titles.get(id) ?? shortId(id);
}
