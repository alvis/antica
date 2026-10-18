import { describe, expect, it, jest } from '@jest/globals';

import { getLocales } from 'expo-localization';
import { AppState } from 'react-native';

import { deviceSystemLocales, onAppForeground } from './locale';

import type { Locale } from 'expo-localization';
import type { AppStateStatus } from 'react-native';

jest.mock(
  'expo-localization',
  () =>
    ({
      getLocales: jest.fn<typeof import('expo-localization').getLocales>(),
    }) satisfies Partial<typeof import('expo-localization')>,
);

describe('cp:deviceSystemLocales', () => {
  it('should report the device languages in preference order', () => {
    jest
      .mocked(getLocales)
      .mockReturnValueOnce([
        { languageTag: 'fr-FR' } as Locale,
        { languageTag: 'zh-Hant-HK' } as Locale,
      ]);

    expect(deviceSystemLocales.readLanguageTags()).toEqual([
      'fr-FR',
      'zh-Hant-HK',
    ]);
  });
});

describe('fn:onAppForeground', () => {
  it('should call the listener only when the app becomes active, until stopped', () => {
    const remove = jest.fn();
    const changes: Array<(state: AppStateStatus) => void> = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, handle) => {
      changes.push(handle);

      return { remove };
    });
    const listener = jest.fn();

    const stop = onAppForeground(listener);
    changes.forEach((change) => change('background'));
    changes.forEach((change) => change('active'));
    stop();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
