import type { RelatedKnowledgePage } from '@antica/contracts';

import type { LocaleState } from '../../providers/LocaleProvider';

/** message keys naming each kind of knowledge entry */
export const knowledgeKindKeys = {
  concept: 'knowledgeConcept',
  method: 'knowledgeMethod',
  object_example: 'knowledgeExample',
} as const;

/** message keys naming the record field a related entry matched */
export const relatedMatchFieldKeys = {
  category: 'knowledgeFacetCategory',
  material: 'material',
  period: 'period',
  name: 'name',
} as const;

/** one reason a saved entry relates to a record */
type RelatedMatch = RelatedKnowledgePage['cards'][number]['matches'][number];

/**
 * names the record field and saved term a related entry matched, such as 類別「陶瓷」
 * @param match the server's match reason
 * @param t translator for the field name and quotes
 * @returns the reason as the collector reads it
 */
export function describeRelatedMatch(
  match: RelatedMatch,
  t: LocaleState['t'],
): string {
  return t('relatedMatch', {
    field: t(relatedMatchFieldKeys[match.field]),
    value: t('quotedField', { field: match.label }),
  });
}
