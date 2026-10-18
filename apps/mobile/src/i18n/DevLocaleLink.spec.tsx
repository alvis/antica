import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

import { useURL } from 'expo-linking';
import { setItemAsync } from 'expo-secure-store';
import { Text } from 'react-native';

import { DevLocaleLink, devLocaleFromUrl } from './DevLocaleLink';
import { LocaleProvider, useLocale } from './LocaleProvider';

import type { FC } from 'react';

jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
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
 * renders the link listener with a visible active locale
 * @returns the rendered tree
 */
async function renderLink(): Promise<void> {
  await render(
    <LocaleProvider>
      <DevLocaleLink />
      <ActiveLocale />
    </LocaleProvider>,
  );
}

afterEach(() => {
  Reflect.set(globalThis, '__DEV__', developmentBuild);
});

describe('fn:devLocaleFromUrl', () => {
  it.each([
    { url: 'antica://?devLocale=zh-Hant', expected: 'zh-Hant' },
    { url: 'antica://login?devLocale=zh-Hans', expected: 'zh-Hans' },
    { url: 'antica://?devLocale=fr', expected: undefined },
    { url: 'antica://?other=1&devLocale=en#top', expected: 'en' },
    { url: 'antica://collection', expected: undefined },
    { url: null, expected: undefined },
  ])('should read $expected from $url', ({ url, expected }) => {
    expect(devLocaleFromUrl(url)).toBe(expected);
  });
});

describe('cp:DevLocaleLink', () => {
  it('should save the language a development link requests', async () => {
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=zh-Hant');

    await renderLink();

    expect(await screen.findByText('zh-Hant')).toBeTruthy();
    expect(setItemAsync).toHaveBeenCalledWith('antica.locale', 'zh-Hant');
  });

  it('should report a requested language that could not be saved', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const failure = new Error('Keychain unavailable.');
    jest.mocked(setItemAsync).mockRejectedValueOnce(failure);
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=zh-Hant');

    await renderLink();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith(
        'The development locale could not be saved.',
        failure,
      ),
    );
    expect(screen.getByText('en')).toBeTruthy();
  });

  it('should leave the language alone for links without a request', async () => {
    jest.mocked(useURL).mockReturnValue('antica://collection');

    await renderLink();

    expect(screen.getByText('en')).toBeTruthy();
    expect(setItemAsync).not.toHaveBeenCalled();
  });

  it('should ignore language requests in release builds', async () => {
    Reflect.set(globalThis, '__DEV__', false);
    jest.mocked(useURL).mockReturnValue('antica://?devLocale=zh-Hant');

    await renderLink();

    await waitFor(() => expect(screen.getByText('en')).toBeTruthy());
    expect(setItemAsync).not.toHaveBeenCalled();
  });
});
