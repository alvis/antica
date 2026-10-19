import { createI18n } from './i18n';

import type { Locale, Translate } from './messages';

/**
 * translates with the bundled dictionaries in one locale, outside a rendered provider
 * @param locale interface locale
 * @returns translation function
 */
export function translator(locale: Locale): Translate {
  const translate = createI18n(locale).t as (
    key: string,
    values?: object,
  ) => string;

  // the dictionary types already check keys and values, so the call forwards them untyped
  return (key: string, values?: object): string => translate(key, values);
}
