import type {
  InterfaceLanguagePreference,
  LocalPreferences,
  LocalPreferencesPort,
} from './preferences';

/**
 * creates in-memory preference storage, as on a device with the given saved state
 * @param initial stored preferences, or null for a new installation
 * @returns storage that keeps every successful write
 */
export function memoryPreferences(
  initial: LocalPreferences | null,
): LocalPreferencesPort {
  // the storage cell changes on every successful write
  let stored = initial;

  return {
    read: async () => stored,
    write: async (preferences) => {
      stored = preferences;
    },
  };
}

/**
 * creates in-memory storage for a device that already saved an interface-language choice
 * @param interfaceLanguage saved choice
 * @returns storage holding that choice
 */
export function savedPreferences(
  interfaceLanguage: InterfaceLanguagePreference,
): LocalPreferencesPort {
  return memoryPreferences({ schemaVersion: 1, interfaceLanguage });
}
