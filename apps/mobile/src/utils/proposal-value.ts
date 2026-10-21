import { formatFieldValue } from './field-value';

import type { ProposedChange } from '@antica/contracts';

import type { Locale, Translate } from '../i18n/messages';

/**
 * writes a suggested or replaced field value the way suggestion cards and edit cards show it (v5):
 * an empty value reads 未填寫, materials by their titles, and an unconfirmed period by its label,
 * which already says it is tentative
 * @param change the proposed change the value belongs to
 * @param value the value before or after the change
 * @param locale interface language
 * @param t translator
 * @param title names a knowledge entry, for materials
 * @returns the value as text
 */
export function proposalValueText(
  change: Pick<ProposedChange, 'field'>,
  value: ProposedChange['before'] | undefined,
  locale: Locale,
  t: Translate,
  title: (id: string) => string,
): string {
  if (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0)
  ) {
    return t('recordFactEmpty');
  }
  if (change.field === 'categoryIds' && Array.isArray(value)) {
    return value.map(title).join(' · ');
  }
  if (change.field === 'materialIds' && Array.isArray(value)) {
    return value.map(title).join(t('proposalMaterialSeparator'));
  }
  if (
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'status' in value &&
    value.status === 'unconfirmed' &&
    value.fromYear === undefined &&
    value.toYear === undefined
  ) {
    return value.label;
  }

  return formatFieldValue(value, locale, t);
}
