import type { LocaleState } from '../providers/LocaleProvider';

/**
 * joins field names as the assistant says them, such as 「名稱」與「材質」
 * @param names localized field names
 * @param t translator for the quotes and separators
 * @returns the quoted list
 */
export function quoteFields(
  names: readonly string[],
  t: LocaleState['t'],
): string {
  const quoted = names.map((name) => t('quotedField', { field: name }));
  if (quoted.length < 2) {
    return quoted.join('');
  }

  return `${quoted.slice(0, -1).join(t('listSeparator'))}${t('listAnd')}${quoted.at(-1)}`;
}
