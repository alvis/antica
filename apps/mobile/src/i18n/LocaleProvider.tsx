import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { messages } from './messages';

import type { FC, PropsWithChildren } from 'react';

import type { Locale, MessageKey } from './messages';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
  t: (key: MessageKey) => string;
}

const localeContext = createContext<LocaleContextValue | null>(null);

export const LocaleProvider: FC<PropsWithChildren> = ({ children }) => {
  const [locale, setCurrentLocale] = useState<Locale>('en');

  useEffect(() => {
    let active = true;
    void getItemAsync('antica.locale').then((saved) => {
      if (active && saved === 'zh-Hant') {
        setCurrentLocale(saved);
      }
    });

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: async (next: Locale): Promise<void> => {
        await setItemAsync('antica.locale', next);
        setCurrentLocale(next);
      },
      t: (key: MessageKey): string => messages[key][locale === 'en' ? 0 : 1],
    }),
    [locale],
  );

  return (
    <localeContext.Provider value={value}>{children}</localeContext.Provider>
  );
};

/**
 * returns the active mobile locale and translation function
 * @returns locale state and translation function
 * @throws {Error} when LocaleProvider is missing
 */
export function useLocale(): LocaleContextValue {
  const value = useContext(localeContext);
  if (value === null) {
    throw new Error('LocaleProvider is missing.');
  }

  return value;
}
