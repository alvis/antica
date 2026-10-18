import { getLocales } from 'expo-localization';

import type { Locale as DeviceLanguage } from 'expo-localization';

import type { Locale } from './resources';

/** regions whose Chinese is written in Simplified characters */
const simplifiedRegions = new Set(['CN', 'SG', 'MY']);

/**
 * maps one device language to a supported interface language
 * @param language device language from expo-localization
 * @returns the supported locale, or undefined when the language is unsupported
 */
function toLocale(language: DeviceLanguage): Locale | undefined {
  if (language.languageCode === 'en') {
    return 'en';
  }
  if (language.languageCode !== 'zh') {
    return undefined;
  }
  if (language.languageScriptCode) {
    return language.languageScriptCode === 'Hans' ? 'zh-Hans' : 'zh-Hant';
  }

  return simplifiedRegions.has(language.regionCode ?? '')
    ? 'zh-Hans'
    : 'zh-Hant';
}

/**
 * picks the first device-preferred language the app supports
 * @returns the supported locale, or undefined when the device prefers none of them
 */
export function deviceLocale(): Locale | undefined {
  for (const language of getLocales()) {
    const locale = toLocale(language);
    if (locale) {
      return locale;
    }
  }

  return undefined;
}
