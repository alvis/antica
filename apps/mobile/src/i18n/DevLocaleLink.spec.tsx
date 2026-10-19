import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

import { useURL } from 'expo-linking';
import { Text } from 'react-native';

import { LocaleProvider, useLocale } from '../providers/LocaleProvider';

import { DevLocaleLink, devLocaleFromUrl } from './DevLocaleLink';

import type { FC } from 'react';

import type { LocalPreferencesPort } from './preferences';

jest.mock(
  'expo-linking',
  () =>
    ({
      useURL: jest.fn<typeof import('expo-linking').useURL>(() => null),
    }) satisfies Partial<typeof import('expo-linking')>,
);

const developmentBuild = __DEV__;

const ActiveLocale: FC = () => {
  const { locale } = useLocale();

  return <Text>{locale}</Text>;
};

/**
 * renders the link listener with a visible active locale on a new installation
 * @returns the device's preference storage
 */
async function renderLink(): Promise<{
  read: jest.Mock<LocalPreferencesPort['read']>;
  write: jest.Mock<LocalPreferencesPort['write']>;
}> {
  const preferences = {
    read: jest.fn<LocalPreferencesPort['read']>(async () => null),
    write: jest.fn<LocalPreferencesPort['write']>(async () => undefined),
  };
  await render(
    <LocaleProvider preferences={preferences}>
      <DevLocaleLink />
      <ActiveLocale />
    </LocaleProvider>,
  );

  return preferences;
}

afterEach(() => {
  Reflect.set(globalThis, '__DEV__', developmentBuild);
});

describe('fn:devLocaleFromUrl', () => {
  it.each([
    { url: 'antica://?devLocale=zh-Hant', expected: 'zh-Hant' },
    { url: 'antica://login?devLocale=zh-Hans', expected: 'zh-Hans' },
    { url: 'antica://?devLocale=system', expected: 'system' },
    { url: 'antica://?devLocale=fr', expected: undefined },
    { url: 'antica://?other=1&devLocale=en#top', expected: 'en' },
    { url: 'antica://collection', expected: undefined },
    { url: null, expected: undefined },
  ])('should read $expected from $url', ({ url, expected }) => {
    expect(devLocaleFromUrl(url)).toBe(expected);
  });
});

describe('cp:DevLocaleLink', () => {
  it('should save the requested language once through the preference operation', async () => {
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=en');

    const preferences = await renderLink();

    expect(await screen.findByText('en')).toBeTruthy();
    expect(preferences.write.mock.calls).toEqual([
      [{ schemaVersion: 1, interfaceLanguage: 'en' }],
    ]);
  });

  it('should report a requested language that could not be saved', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const failure = new Error('Keychain unavailable.');
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=en');
    const preferences = {
      read: async () => null,
      write: jest.fn<LocalPreferencesPort['write']>(async () => {
        throw failure;
      }),
    };

    await render(
      <LocaleProvider preferences={preferences}>
        <DevLocaleLink />
        <ActiveLocale />
      </LocaleProvider>,
    );

    await waitFor(() =>
      expect(warn.mock.calls).toEqual([
        ['The development locale could not be saved.', failure],
      ]),
    );
    expect(screen.getByText('zh-Hant')).toBeTruthy();
  });

  it('should leave the language alone for links without a request', async () => {
    jest.mocked(useURL).mockReturnValue('antica://collection');

    const preferences = await renderLink();

    expect(screen.getByText('zh-Hant')).toBeTruthy();
    expect(preferences.write).not.toHaveBeenCalled();
  });

  it('should ignore language requests in release builds', async () => {
    Reflect.set(globalThis, '__DEV__', false);
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=en');

    const preferences = await renderLink();

    expect(screen.getByText('zh-Hant')).toBeTruthy();
    expect(preferences.write).not.toHaveBeenCalled();
  });
});
