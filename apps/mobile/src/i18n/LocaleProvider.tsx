import { getItemAsync, setItemAsync } from 'expo-secure-store';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';

import { createI18n } from './i18n';
import { defaultLocale, isLocale } from './resources';

import type { FC, PropsWithChildren } from 'react';

import type { Translate } from './messages';
import type { Locale } from './resources';

/** secure-store key holding the collector's saved interface language */
export const localeStorageKey = 'antica.locale';

interface LocaleContextValue {
  locale: Locale;
  setLocale: (next: Locale) => Promise<void>;
}

/** the active locale, its setter, and the translation function */
export interface LocaleState extends LocaleContextValue {
  t: Translate;
}

const localeContext = createContext<LocaleContextValue | null>(null);

/**
 * provides i18next and the saved interface language to the app
 * @param props provider properties
 * @param props.children content rendered in the active language
 * @returns the localized subtree
 */
export const LocaleProvider: FC<PropsWithChildren> = ({ children }) => {
  const [i18n] = useState(() => createI18n(defaultLocale));
  const [locale, setCurrentLocale] = useState<Locale>(defaultLocale);
  // a choice made before the saved language loads wins over the saved value
  const chosen = useRef(false);

  const apply = useCallback(
    (next: Locale): void => {
      void i18n.changeLanguage(next);
      setCurrentLocale(next);
    },
    [i18n],
  );

  useEffect(() => {
    let active = true;
    void getItemAsync(localeStorageKey).then((saved) => {
      if (active && !chosen.current && isLocale(saved)) {
        apply(saved);
      }
    });

    return () => {
      active = false;
    };
  }, [apply]);

  const setLocale = useCallback(
    async (next: Locale): Promise<void> => {
      chosen.current = true;
      await setItemAsync(localeStorageKey, next);
      apply(next);
    },
    [apply],
  );

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale }),
    [locale, setLocale],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <localeContext.Provider value={value}>{children}</localeContext.Provider>
    </I18nextProvider>
  );
};

/**
 * returns the active mobile locale and translation function
 * @returns locale state and translation function
 * @throws {Error} when LocaleProvider is missing
 */
export function useLocale(): LocaleState {
  const value = useContext(localeContext);
  const { t: translate } = useTranslation();
  // the dictionary types already check keys and values, so the call forwards them untyped
  const t = useMemo<Translate>(
    () =>
      (key: string, values?: object): string =>
        (translate as (key: string, values?: object) => string)(key, values),
    [translate],
  );
  if (value === null) {
    throw new Error('LocaleProvider is missing.');
  }

  return { ...value, t };
}
