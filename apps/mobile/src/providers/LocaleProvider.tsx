import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { styles } from '@antica/ui';

import { deviceSystemLocales, onAppForeground } from '../adapters/locale';
import { devicePreferences } from '../adapters/preferences';
import { createI18n } from '../i18n/i18n';
import {
  defaultLocalPreferences,
  readLocalPreferences,
  resolveInterfaceLocale,
  safeInterfaceLocale,
  setInterfaceLanguage,
} from '../i18n/preferences';

import type { TFunction } from 'i18next';

import type { Dispatch, FC, PropsWithChildren, SetStateAction } from 'react';

import type { Translate } from '../i18n/messages';
import type {
  InterfaceLanguagePreference,
  InterfaceLocale,
  LocalPreferences,
  LocalPreferencesPort,
  ResolvedInterfaceLanguage,
  SystemLocalePort,
} from '../i18n/preferences';

/** progress of reading the saved preferences at startup */
export type PreferencesStatus = 'loading' | 'ready' | 'read_failed';

/** how a not-yet-saved choice would render, for the language screen's preview */
export interface InterfaceLanguagePreview {
  /** locale the choice resolves to on this device */
  resolved: ResolvedInterfaceLanguage;
  /** translation function fixed to that locale */
  t: Translate;
}

/** saved interface language, its effective locale, and the operations that change it */
export interface InterfaceLanguageState {
  /** whether the saved preferences loaded; a failed read renders in safe Traditional Chinese */
  status: PreferencesStatus;
  /** saved preferences, or the in-memory default while they are unreadable */
  saved: LocalPreferences;
  /** locale the interface renders in */
  resolved: ResolvedInterfaceLanguage;
  /**
   * stores a choice and switches app-owned copy in place; a failed write leaves the previous choice active
   * @param preference choice to save
   * @returns completion once the choice is stored and applied
   */
  save: (preference: InterfaceLanguagePreference) => Promise<void>;
  /**
   * reads the saved preferences again after a failed read
   * @returns completion of the read
   */
  retryRead: () => Promise<void>;
  /**
   * resolves a choice without saving it
   * @param preference choice to preview
   * @returns its effective locale and a translation function in that locale
   */
  preview: (
    preference: InterfaceLanguagePreference,
  ) => InterfaceLanguagePreview;
}

/** the active locale and the translation function */
export interface LocaleState {
  /** locale the interface renders in */
  locale: InterfaceLocale;
  /** translates a message key into the active locale */
  t: Translate;
}

/** device adapters the provider reads; tests and stories substitute in-memory ones */
export type LocaleProviderProps = PropsWithChildren<{
  /** device-local preference storage */
  preferences?: LocalPreferencesPort;
  /** device language source for Follow system */
  systemLocales?: SystemLocalePort;
}>;

/** loaded preference state from which the effective locale is derived */
interface PreferenceSnapshot {
  status: PreferencesStatus;
  saved: LocalPreferences;
  /** device languages last read, most preferred first */
  systemTags: readonly string[];
}

/** longest wait for device storage before the safe default is shown uncovered */
const preferenceReadTimeoutMs = 3_000;

const layout = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: 'center' },
});

const interfaceLanguageContext = createContext<InterfaceLanguageState | null>(
  null,
);

/** device adapters fixed for the provider's lifetime */
interface Devices {
  preferences: LocalPreferencesPort;
  systemLocales: SystemLocalePort;
}

/** replaces the snapshot or derives the next one from the latest */
type SetSnapshot = Dispatch<SetStateAction<PreferenceSnapshot>>;

/**
 * holds the saved preferences with the device languages, reads them once, and stores new choices
 * @param devices preference storage and device language source
 * @returns the snapshot, its setter, and the read and save operations
 */
function usePreferenceSnapshot(devices: Devices): {
  snapshot: PreferenceSnapshot;
  setSnapshot: SetSnapshot;
  read: () => Promise<void>;
  save: (preference: InterfaceLanguagePreference) => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<PreferenceSnapshot>(() => ({
    status: 'loading',
    saved: defaultLocalPreferences,
    systemTags: devices.systemLocales.readLanguageTags(),
  }));
  // counts saves, so a read that finishes after a save cannot restore the older choice
  const saves = useRef(0);
  const mounted = useRef(true);

  const read = useCallback(async (): Promise<void> => {
    const savesAtStart = saves.current;
    const current = (): boolean =>
      mounted.current && savesAtStart === saves.current;
    try {
      const saved = await readLocalPreferences(devices.preferences);
      if (current()) {
        setSnapshot({
          status: 'ready',
          saved,
          systemTags: devices.systemLocales.readLanguageTags(),
        });
      }
    } catch {
      // the safe in-memory default stays active; Settings offers to read again
      if (current()) {
        setSnapshot((previous) => ({ ...previous, status: 'read_failed' }));
      }
    }
  }, [devices]);

  useEffect(() => {
    mounted.current = true;
    void read();

    return () => {
      mounted.current = false;
    };
  }, [read]);

  const save = useCallback(
    async (preference: InterfaceLanguagePreference): Promise<void> => {
      const saved = await setInterfaceLanguage(devices.preferences, preference);
      saves.current += 1;
      setSnapshot({
        status: 'ready',
        saved,
        systemTags: devices.systemLocales.readLanguageTags(),
      });
    },
    [devices],
  );

  return { snapshot, setSnapshot, read, save };
}

/**
 * stops waiting for a storage that never answers, so it cannot keep the app covered; a late
 * answer still applies
 * @param loading whether the first read is still running
 * @param setSnapshot snapshot setter
 */
function useReadTimeout(loading: boolean, setSnapshot: SetSnapshot): void {
  useEffect(() => {
    if (!loading) {
      return undefined;
    }
    const timer = setTimeout(
      () =>
        setSnapshot((previous) =>
          previous.status === 'loading'
            ? { ...previous, status: 'read_failed' }
            : previous,
        ),
      preferenceReadTimeoutMs,
    );

    return () => clearTimeout(timer);
  }, [loading, setSnapshot]);
}

/**
 * re-reads the device languages when the collector returns to the app, so Follow system follows
 * a language changed meanwhile; an explicit choice resolves to itself whatever the device reports
 * @param systemLocales device language source
 * @param setSnapshot snapshot setter
 */
function useForegroundLanguages(
  systemLocales: SystemLocalePort,
  setSnapshot: SetSnapshot,
): void {
  useEffect(
    () =>
      onAppForeground(() => {
        const systemTags = systemLocales.readLanguageTags();
        setSnapshot((previous) =>
          systemTags.join() === previous.systemTags.join()
            ? previous
            : { ...previous, systemTags },
        );
      }),
    [setSnapshot, systemLocales],
  );
}

/**
 * keeps the subtree mounted and hides it under an opaque cover while the saved language loads
 * @param props cover properties
 * @param props.loading whether the saved language is still being read
 * @param props.label accessible name of the loading indicator
 * @param props.children subtree to keep mounted
 * @returns the subtree with the cover above it while loading
 */
const PreferenceCover: FC<
  PropsWithChildren<{ loading: boolean; label: string }>
> = ({ loading, label, children }) => (
  <View style={layout.fill}>
    <View style={layout.fill} aria-hidden={loading}>
      {children}
    </View>
    {loading ? (
      <View
        testID="locale-loading"
        style={[styles.screen, StyleSheet.absoluteFill, layout.center]}>
        <ActivityIndicator accessibilityLabel={label} />
      </View>
    ) : null}
  </View>
);

/**
 * loads the saved interface language and switches it in place, without remounting the
 * navigation, session, draft or job state beneath it
 *
 * The subtree mounts at once, so session restore and cold-start deep links never wait on device
 * storage; an opaque cover hides it until the saved choice is read, or until the read gives up
 * and the safe default stays active.
 * @param props provider properties
 * @param props.children content rendered in the active language
 * @param props.preferences device-local preference storage
 * @param props.systemLocales device language source for Follow system
 * @returns the localized subtree under the preference-loading cover
 */
export const LocaleProvider: FC<LocaleProviderProps> = ({
  children,
  preferences = devicePreferences,
  systemLocales = deviceSystemLocales,
}) => {
  const [i18n] = useState(() => createI18n(safeInterfaceLocale));
  // adapters are fixed for the provider's lifetime, so a re-render never re-reads storage
  const [devices] = useState<Devices>(() => ({ preferences, systemLocales }));
  const { snapshot, setSnapshot, read, save } = usePreferenceSnapshot(devices);
  const loading = snapshot.status === 'loading';
  useReadTimeout(loading, setSnapshot);
  useForegroundLanguages(devices.systemLocales, setSnapshot);
  const resolved = useMemo(
    () =>
      resolveInterfaceLocale(
        snapshot.saved.interfaceLanguage,
        snapshot.systemTags,
      ),
    [snapshot.saved.interfaceLanguage, snapshot.systemTags],
  );

  // switches before paint, so a frame never shows the previous language
  useLayoutEffect(() => {
    if (i18n.language !== resolved.locale) {
      void i18n.changeLanguage(resolved.locale);
    }
  }, [i18n, resolved.locale]);

  const preview = useCallback(
    (preference: InterfaceLanguagePreference): InterfaceLanguagePreview => {
      const previewed = resolveInterfaceLocale(preference, snapshot.systemTags);

      return {
        resolved: previewed,
        t: toTranslate(i18n.getFixedT(previewed.locale)),
      };
    },
    [i18n, snapshot.systemTags],
  );

  const value = useMemo<InterfaceLanguageState>(
    () => ({
      status: snapshot.status,
      saved: snapshot.saved,
      resolved,
      save,
      retryRead: read,
      preview,
    }),
    [preview, read, resolved, save, snapshot.saved, snapshot.status],
  );

  return (
    <I18nextProvider i18n={i18n}>
      <interfaceLanguageContext.Provider value={value}>
        <PreferenceCover loading={loading} label={i18n.t('loading')}>
          {children}
        </PreferenceCover>
      </interfaceLanguageContext.Provider>
    </I18nextProvider>
  );
};

/**
 * returns the saved interface language and the operations that change it
 * @returns interface-language state and operations
 * @throws {Error} when LocaleProvider is missing
 */
export function useInterfaceLanguage(): InterfaceLanguageState {
  const value = useContext(interfaceLanguageContext);
  if (value === null) {
    throw new Error('LocaleProvider is missing.');
  }

  return value;
}

/**
 * returns the active mobile locale and translation function
 * @returns locale state and translation function
 * @throws {Error} when LocaleProvider is missing
 */
export function useLocale(): LocaleState {
  const value = useContext(interfaceLanguageContext);
  const { t: translate } = useTranslation();
  const t = useMemo(() => toTranslate(translate), [translate]);
  if (value === null) {
    throw new Error('LocaleProvider is missing.');
  }

  return { locale: value.resolved.locale, t };
}

/**
 * adapts an i18next translation function to the app's typed message keys
 * @param translate i18next translation function
 * @returns the typed translation function
 */
function toTranslate(translate: TFunction): Translate {
  // the dictionary types already check keys and values, so the call forwards them untyped
  return (key: string, values?: object): string =>
    (translate as (key: string, values?: object) => string)(key, values);
}
