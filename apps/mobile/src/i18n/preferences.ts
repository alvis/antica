import type { Locale } from './resources';

/** interface language whose dictionary the app bundles */
export type InterfaceLocale = Locale;

/** interface language the collector saves, or a request to follow the device */
export type InterfaceLanguagePreference = InterfaceLocale | 'system';

/** versioned, device-local presentation preferences */
export interface LocalPreferences {
  /** schema version of the stored preference object */
  readonly schemaVersion: 1;
  /** saved interface language choice */
  readonly interfaceLanguage: InterfaceLanguagePreference;
}

/** the interface language in effect and how it was chosen */
export interface ResolvedInterfaceLanguage {
  /** saved choice the locale was resolved from */
  readonly preference: InterfaceLanguagePreference;
  /** bundled locale the interface renders in */
  readonly locale: InterfaceLocale;
  /** whether Follow system found no supported device language and fell back */
  readonly usedSystemFallback: boolean;
}

/** device-local storage for presentation preferences */
export interface LocalPreferencesPort {
  /**
   * reads the stored preferences
   * @returns the stored preferences, or null when none are stored or they are invalid
   */
  read: () => Promise<LocalPreferences | null>;
  /**
   * stores the complete preference object
   * @param preferences preferences to store
   */
  write: (preferences: LocalPreferences) => Promise<void>;
}

/** the device's ordered language preferences */
export interface SystemLocalePort {
  /**
   * reads the device languages, most preferred first
   * @returns BCP 47 language tags
   */
  readLanguageTags: () => readonly string[];
}

/** state of the interface-language screen */
export type LanguageSettingsState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly saved: LocalPreferences;
      readonly draft: InterfaceLanguagePreference;
    }
  | {
      readonly kind: 'saving';
      readonly saved: LocalPreferences;
      readonly draft: InterfaceLanguagePreference;
    }
  | {
      readonly kind: 'error';
      readonly saved: LocalPreferences;
      readonly draft: InterfaceLanguagePreference;
      readonly reason: 'read_failed' | 'write_failed';
    };

/** every choice the language screen offers, in display order */
export const interfaceLanguagePreferences = [
  'zh-Hant',
  'zh-Hans',
  'en',
  'system',
] as const satisfies readonly InterfaceLanguagePreference[];

/** locale used with no saved choice, a corrupt one, or no supported device language */
export const safeInterfaceLocale = 'zh-Hant' satisfies InterfaceLocale;

/** preferences of a new installation: Traditional Chinese whatever the device language */
export const defaultLocalPreferences: LocalPreferences = {
  schemaVersion: 1,
  interfaceLanguage: safeInterfaceLocale,
};

/** each locale's name in its own writing system, shown whatever the interface language */
export const localeAutonyms = {
  'zh-Hant': '繁體中文',
  'zh-Hans': '简体中文',
  'en': 'English',
} as const satisfies Record<InterfaceLocale, string>;

/** regions whose Chinese is written in Simplified characters */
const simplifiedRegions = new Set(['CN', 'SG']);

/**
 * tells whether a value names a choice the language screen offers
 * @param value candidate stored or requested choice
 * @returns whether the value is an allowlisted interface-language choice
 */
export function isInterfaceLanguagePreference(
  value: unknown,
): value is InterfaceLanguagePreference {
  return interfaceLanguagePreferences.some((choice) => choice === value);
}

/**
 * validates a decoded preference object against the version-1 allowlist
 * @param value decoded stored value
 * @returns the preferences, or null when the value is not a valid version-1 object
 */
export function parseLocalPreferences(value: unknown): LocalPreferences | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { schemaVersion, interfaceLanguage } = value as Partial<
    Record<keyof LocalPreferences, unknown>
  >;

  return schemaVersion === 1 && isInterfaceLanguagePreference(interfaceLanguage)
    ? { schemaVersion, interfaceLanguage }
    : null;
}

/**
 * reads the saved preferences, using the Traditional Chinese default when none are stored
 * @param port device-local preference storage
 * @returns the saved or default preferences
 */
export async function readLocalPreferences(
  port: LocalPreferencesPort,
): Promise<LocalPreferences> {
  return (await port.read()) ?? defaultLocalPreferences;
}

/**
 * stores an interface-language choice as a complete versioned object before reporting success
 * @param port device-local preference storage
 * @param preference choice to save
 * @returns the stored preferences
 */
export async function setInterfaceLanguage(
  port: LocalPreferencesPort,
  preference: InterfaceLanguagePreference,
): Promise<LocalPreferences> {
  const preferences: LocalPreferences = {
    schemaVersion: 1,
    interfaceLanguage: preference,
  };
  await port.write(preferences);

  return preferences;
}

/**
 * resolves a saved choice to the bundled locale the interface renders in
 * @param preference saved choice
 * @param languageTags device languages, most preferred first
 * @returns the effective locale and whether Follow system fell back
 */
export function resolveInterfaceLocale(
  preference: InterfaceLanguagePreference,
  languageTags: readonly string[],
): ResolvedInterfaceLanguage {
  if (preference !== 'system') {
    return { preference, locale: preference, usedSystemFallback: false };
  }
  const locale = languageTags
    .map(localeFromLanguageTag)
    .find((candidate) => candidate !== undefined);

  return {
    preference,
    locale: locale ?? safeInterfaceLocale,
    usedSystemFallback: locale === undefined,
  };
}

/** length of a BCP 47 script subtag such as Hant */
const scriptSubtagLength = 4;

/**
 * maps one device language tag to a bundled locale by script, then region
 * @param tag BCP 47 language tag such as zh-Hant-HK, zh_CN or en-GB
 * @returns the bundled locale, or undefined when the language is unsupported
 */
function localeFromLanguageTag(tag: string): InterfaceLocale | undefined {
  const [language, ...rest] = tag.toLowerCase().split(/[-_]/);
  // extension and private-use subtags (after u-, x- and other singletons) never name a script or region
  const singleton = rest.findIndex((subtag) => subtag.length === 1);
  const subtags = singleton === -1 ? rest : rest.slice(0, singleton);
  if (language === 'en') {
    return 'en';
  }
  if (language !== 'zh') {
    return undefined;
  }
  const script = subtags.find((subtag) => subtag.length === scriptSubtagLength);
  if (script === 'hant' || script === 'hans') {
    return script === 'hant' ? 'zh-Hant' : 'zh-Hans';
  }
  const region = subtags.find((subtag) => subtag.length === 2)?.toUpperCase();

  // TW, HK and MO write Traditional characters, as does a bare zh or any other region
  return region && simplifiedRegions.has(region) ? 'zh-Hans' : 'zh-Hant';
}
