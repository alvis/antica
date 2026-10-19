import { relatedKnowledgePageSchema } from '@antica/contracts';

import { tokenizeSearchText } from '../../../search/text/tokenizer.js';

import { relatedKnowledgeSql } from './search-related-sql.js';

import type {
  RelatedKnowledgePage,
  RelatedKnowledgeQuery,
} from '@antica/contracts';

import type { KnowledgeContext } from './v2.js';

/**
 * reads related saved entries and their owner's record under one SQL snapshot
 * @param context owner-scoped connection
 * @param recordId explicit record identity
 * @param input bounded display and revision binding
 * @returns record-bound saved cards, or null for an inaccessible record
 */
export async function readRelatedKnowledge(
  context: KnowledgeContext,
  recordId: string,
  input: RelatedKnowledgeQuery,
): Promise<RelatedKnowledgePage | null> {
  const rows = await context.tx.$queryRaw<Array<{ data: unknown }>>(
    relatedKnowledgeSql(context.ownerId, recordId, input),
  );
  if (!rows[0]) {
    return null;
  }
  const snapshot = relatedKnowledgePageSchema.parse(rows[0].data);
  const cards = snapshot.cards.map((card) => ({
    ...card,
    matches: card.matches.map((match) => {
      const tokens = new Set(tokenizeSearchText(match.value).tokens);

      return {
        ...match,
        matchedTokens: tokenizeSearchText(match.label).tokens.filter((token) =>
          tokens.has(token),
        ),
      };
    }),
  }));

  return cards.length === 0
    ? { ...snapshot, cards, reason: 'no_match' }
    : { ...snapshot, cards };
}
