import { periodName } from '../collection/record-hub-display';

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
 * names the record field a related entry matched; a value the assistant only suggested is named
 * as a suggestion, such as 建議的材質, so it never reads as a saved fact of the record
 * @param match the server's match reason
 * @param t translator for the field name
 * @returns the field as the collector reads it
 */
export function relatedMatchField(
  match: RelatedMatch,
  t: LocaleState['t'],
): string {
  const field = t(relatedMatchFieldKeys[match.field]);

  return match.source === 'suggestion'
    ? t('relatedSuggestedField', { field })
    : field;
}

/**
 * names the record field and term a related entry matched, such as 類別「陶瓷」 or
 * 建議的材質「炻器」; a period reads as the record's tiles read it (清 as 清代)
 * @param match the server's match reason
 * @param t translator for the field name and quotes
 * @param locale interface locale
 * @returns the reason as the collector reads it
 */
export function describeRelatedMatch(
  match: RelatedMatch,
  t: LocaleState['t'],
  locale: LocaleState['locale'],
): string {
  const label =
    match.source === 'suggestion'
      ? match.value
      : match.field === 'period'
        ? periodName(match.label, locale)
        : match.label;

  return t('relatedMatch', {
    field: relatedMatchField(match, t),
    value: t('quotedField', { field: label }),
  });
}
