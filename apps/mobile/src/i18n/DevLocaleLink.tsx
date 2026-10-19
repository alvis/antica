import { useURL } from 'expo-linking';
import { useEffect, useRef } from 'react';

import { useInterfaceLanguage } from '../providers/LocaleProvider';

import { isInterfaceLanguagePreference } from './preferences';

import type { FC } from 'react';

import type { InterfaceLanguagePreference } from './preferences';

/**
 * reads the interface language a development link requests, such as `antica://?devLocale=zh-Hant`
 * @param url incoming or initial app link
 * @returns the requested choice, including `system`, or undefined when the link names none
 */
export function devLocaleFromUrl(
  url: string | null,
): InterfaceLanguagePreference | undefined {
  const requested = url?.match(/[?&]devLocale=([^&#]*)/)?.[1];

  return isInterfaceLanguagePreference(requested) ? requested : undefined;
}

/**
 * saves the language a development link requests through the same preference operation as
 * Settings, so end-to-end runs can choose it; release builds ignore links
 * @returns nothing; the component only listens for links
 */
export const DevLocaleLink: FC = () => {
  const url = useURL();
  const { save } = useInterfaceLanguage();
  // each link is applied once, so a later choice in Settings is not overwritten
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const requested = __DEV__ ? devLocaleFromUrl(url) : undefined;
    if (requested && handled.current !== url) {
      handled.current = url;
      save(requested).catch((cause: unknown) =>
        console.warn('The development locale could not be saved.', cause),
      );
    }
  }, [save, url]);

  return null;
};
