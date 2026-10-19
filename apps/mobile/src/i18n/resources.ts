import { en } from './locales/en';
import { zhHans } from './locales/zh-Hans';
import { zhHant } from './locales/zh-Hant';

/** bundled i18next resources, one translation namespace per supported locale */
export const resources = {
  'zh-Hant': { translation: zhHant },
  'zh-Hans': { translation: zhHans },
  'en': { translation: en },
} as const;

/** interface language the collector can choose */
export type Locale = keyof typeof resources;

/** every supported interface language, Traditional Chinese first */
export const locales = Object.keys(resources) as readonly Locale[];

/**
 * tells whether a stored or requested value names a supported locale
 * @param value candidate language tag
 * @returns whether the value is a supported locale
 */
export function isLocale(value: unknown): value is Locale {
  return locales.some((locale) => locale === value);
}
