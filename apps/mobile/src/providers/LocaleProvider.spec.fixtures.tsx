import { jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { AppState } from 'react-native';

import {
  LocaleProvider,
  useInterfaceLanguage,
  useLocale,
} from './LocaleProvider';

import type { RenderHookResult } from '@testing-library/react-native';

import type { FC, PropsWithChildren } from 'react';
import type { AppStateStatus } from 'react-native';

import type {
  InterfaceLanguagePreference,
  LocalPreferences,
  LocalPreferencesPort,
  SystemLocalePort,
} from '../i18n/preferences';

/** both locale hooks, as one rendered result */
type LanguageHooks = ReturnType<typeof useInterfaceLanguage> &
  ReturnType<typeof useLocale>;

/**
 * stores preferences in memory, as on a device with the given saved state
 * @param initial stored preferences, or null for a new installation
 * @returns observable storage
 */
export function storage(initial: LocalPreferences | null): {
  read: jest.Mock<LocalPreferencesPort['read']>;
  write: jest.Mock<LocalPreferencesPort['write']>;
} {
  return {
    read: jest.fn(async () => initial),
    write: jest.fn(async () => undefined),
  };
}

/**
 * builds saved preferences
 * @param interfaceLanguage saved choice
 * @returns version-1 preferences
 */
export function saved(
  interfaceLanguage: InterfaceLanguagePreference,
): LocalPreferences {
  return { schemaVersion: 1, interfaceLanguage };
}

/**
 * reports device languages, as Expo Localization would
 * @param tags device languages, most preferred first
 * @returns a device language source whose answer tests can change
 */
export function device(tags: readonly string[]): jest.Mocked<SystemLocalePort> {
  return { readLanguageTags: jest.fn(() => tags) };
}

/**
 * captures the app-state listener so a test can bring the app back to the foreground
 * @returns a function that reports the app becoming active
 */
export function foreground(): () => Promise<void> {
  const listeners: Array<(state: AppStateStatus) => void> = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_, listener) => {
    listeners.push(listener);

    return { remove: () => undefined };
  });

  return async () =>
    act(async () => listeners.forEach((listener) => listener('active')));
}

/**
 * renders the locale hooks inside a provider with the given device
 * @param preferences preference storage
 * @param systemLocales device language source
 * @returns the rendered hook result
 */
export async function renderLanguage(
  preferences: LocalPreferencesPort,
  systemLocales: SystemLocalePort = device(['en-US']),
): Promise<RenderHookResult<LanguageHooks, unknown>> {
  const Wrapper: FC<PropsWithChildren> = ({ children }) => (
    <LocaleProvider preferences={preferences} systemLocales={systemLocales}>
      {children}
    </LocaleProvider>
  );

  return renderHook(() => ({ ...useInterfaceLanguage(), ...useLocale() }), {
    wrapper: Wrapper,
  });
}
