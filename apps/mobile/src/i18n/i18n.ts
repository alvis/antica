import { createInstance } from 'i18next';

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
    // every locale carries every key, which the dictionary parity test enforces
    fallbackLng: false,
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
