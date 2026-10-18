import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import { parseLocalPreferences } from '../i18n/preferences';
import { isLocale } from '../i18n/resources';

import type {
  LocalPreferences,
  LocalPreferencesPort,
} from '../i18n/preferences';

/** device-local key holding the versioned presentation preferences */
export const preferencesStorageKey = 'antica.preferences.v1';

/** key of the bare interface language saved by builds before versioned preferences */
export const legacyLocaleStorageKey = 'antica.locale';

/**
 * stores non-sensitive presentation preferences on this installation; it never holds
 * session tokens or private collection data
 */
export const devicePreferences: LocalPreferencesPort = {
  read: async () => {
    const stored = await getItemAsync(preferencesStorageKey);

    return stored === null ? migrateLegacyLocale() : decode(stored);
  },
  write: async (preferences) =>
    setItemAsync(preferencesStorageKey, JSON.stringify(preferences)),
};

/**
 * decodes stored preferences, treating malformed or unknown content as absent
 * @param stored stored JSON text
 * @returns the validated preferences, or null when the content is not a valid version-1 object
 */
function decode(stored: string): LocalPreferences | null {
  try {
    return parseLocalPreferences(JSON.parse(stored));
  } catch {
    // a corrupt value is treated like a missing one, so the safe default applies
    return null;
  }
}

/**
 * moves a bare language saved by an earlier build into the versioned object
 * @returns the migrated preferences, or null when no supported earlier language is stored
 */
async function migrateLegacyLocale(): Promise<LocalPreferences | null> {
  const legacy = await getItemAsync(legacyLocaleStorageKey);
  if (!isLocale(legacy)) {
    return null;
  }
  const preferences: LocalPreferences = {
    schemaVersion: 1,
    interfaceLanguage: legacy,
  };
  try {
    await setItemAsync(preferencesStorageKey, JSON.stringify(preferences));
  } catch {
    // the choice still applies; the earlier key stays, so the next read migrates again
    return preferences;
  }
  // the versioned copy is saved and read first from now on, so a leftover earlier key is inert
  await deleteItemAsync(legacyLocaleStorageKey).catch(() => undefined);

  return preferences;
}
