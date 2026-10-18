import { useURL } from 'expo-linking';
import { useEffect } from 'react';

import { useLocale } from './LocaleProvider';
import { isLocale } from './resources';

import type { FC } from 'react';

import type { Locale } from './resources';

/**
 * reads the interface language a development link requests, such as `antica://?devLocale=zh-Hant`
 * @param url incoming or initial app link
 * @returns the requested supported locale, or undefined when the link names none
 */
export function devLocaleFromUrl(url: string | null): Locale | undefined {
  const requested = url?.match(/[?&]devLocale=([^&#]*)/)?.[1];

  return isLocale(requested) ? requested : undefined;
}

/**
 * saves the language requested by a development link so end-to-end runs can choose it; release builds ignore links
 * @returns nothing; the component only listens for links
 */
export const DevLocaleLink: FC = () => {
  const url = useURL();
  const { setLocale } = useLocale();

  useEffect(() => {
    const requested = __DEV__ ? devLocaleFromUrl(url) : undefined;
    if (requested) {
      setLocale(requested).catch((cause: unknown) =>
        console.warn('The development locale could not be saved.', cause),
      );
    }
  }, [setLocale, url]);

  return null;
};
