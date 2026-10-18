import { createInstance } from 'i18next';

import { safeInterfaceLocale } from './preferences';
import { locales, resources } from './resources';

import type { i18n as I18n } from 'i18next';

import type { Locale } from './resources';

/**
 * creates an i18next instance that is ready synchronously from the bundled dictionaries
 * @param locale language to start in
 * @returns an initialised instance for one I18nextProvider
 */
export function createI18n(locale: Locale): I18n {
  const instance = createInstance({
    resources,
    lng: locale,
    supportedLngs: locales,
    load: 'currentOnly',
    // a key missing from a locale falls back to the complete Traditional Chinese
    // dictionary; the dictionary parity test keeps that from replacing translation
    fallbackLng: safeInterfaceLocale,
    // development builds report a key that no dictionary carries, never user text
    saveMissing: __DEV__,
    missingKeyHandler: (_languages, _namespace, key) =>
      console.warn('Missing interface translation key.', key),
    // dictionaries are bundled, so initialisation completes before this returns
    initAsync: false,
    // React Native renders text, not HTML, so values need no escaping
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  // left out of react-i18next's global so each LocaleProvider scopes its own instance
  void instance.init();

  return instance;
}
