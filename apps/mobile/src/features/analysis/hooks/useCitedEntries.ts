import { useQueries } from '@tanstack/react-query';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { knowledgeDetailQuery } from '../../knowledge/hooks/useKnowledgeEntry';
import {
  pickCardImage,
  providerName,
} from '../../knowledge/hooks/useKnowledgePreview';
import { useRelatedKnowledge } from '../../knowledge/hooks/useRelatedKnowledge';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

/** a saved knowledge entry that holds a source an analysis cites */
export interface CitedEntry {
  readonly entryId: string;
  readonly revision: number;
  readonly title: string;
  /** the museum the cited source belongs to, such as 大都會藝術博物館 */
  readonly museum?: string;
  readonly image?: KnowledgeContentEnvelopeV2['images'][number];
}

/**
 * finds, among the record's related knowledge, the saved entry behind each cited source, so a
 * suggestion can show the museum example it rests on; the related entries are the ones the record
 * hub already reads, so this usually costs no request
 * @param recordId record the suggestions are about
 * @param recordRevision record revision on screen
 * @returns the entry holding each citation, keyed by citation id
 */
export function useCitedEntries(
  recordId: string | undefined,
  recordRevision: number | undefined,
): ReadonlyMap<string, CitedEntry> {
  const { api, userId } = useAuth();
  const { locale, t } = useLocale();
  const related = useRelatedKnowledge(recordId, recordRevision);
  const cards = related.data?.cards ?? [];
  const entries = useQueries({
    queries: cards.map((card) =>
      knowledgeDetailQuery({
        api,
        userId,
        locale,
        entryId: card.entryId,
        view: 'revision',
        revision: card.revision,
      }),
    ),
  });
  const cited = new Map<string, CitedEntry>();
  entries.forEach((entry, index) => {
    const card = cards[index];
    const content = entry.data?.content;
    if (!content) {
      return;
    }
    for (const citation of content.citations) {
      if (!cited.has(citation.id)) {
        cited.set(citation.id, {
          entryId: card.entryId,
          revision: card.revision,
          title: card.title,
          museum:
            citation.locator.kind === 'structured'
              ? providerName(citation.locator.provider, t)
              : undefined,
          image: pickCardImage(content.images),
        });
      }
    }
  });

  return cited;
}
