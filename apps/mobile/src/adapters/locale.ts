import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';

import type { SystemLocalePort } from '../i18n/preferences';

/** reads the device's effective languages through Expo Localization */
export const deviceSystemLocales: SystemLocalePort = {
  readLanguageTags: () => getLocales().map(({ languageTag }) => languageTag),
};

/**
 * calls the listener each time the app returns to the foreground, when the device language may have changed
 * @param listener called on each return to the foreground
 * @returns a function that stops listening
 */
export function onAppForeground(listener: () => void): () => void {
  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      listener();
    }
  });

  return () => subscription.remove();
}
