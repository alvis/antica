import { describe, expect, it, jest } from '@jest/globals';

import { getLocales } from 'expo-localization';

import { deviceLocale } from './device-locale';

import type { Locale } from 'expo-localization';

jest.mock(
  'expo-localization',
  () =>
    ({
      getLocales: jest.fn<typeof import('expo-localization').getLocales>(),
    }) satisfies Partial<typeof import('expo-localization')>,
);

/**
 * describes one device language the way expo-localization reports it
 * @param languageCode ISO language code
 * @param languageScriptCode ISO script code, when the device reports one
 * @param regionCode ISO region code, when the device reports one
 * @returns the device language
 */
function language(
  languageCode: string,
  languageScriptCode: string | null = null,
  regionCode: string | null = null,
): Locale {
  return {
    languageTag: [languageCode, languageScriptCode, regionCode]
      .filter(Boolean)
      .join('-'),
    languageCode,
    languageScriptCode,
    regionCode,
  } as Locale;
}

describe('fn:deviceLocale', () => {
  it.each([
    {
      name: 'zh-Hant-TW',
      languages: [language('zh', 'Hant', 'TW')],
      expected: 'zh-Hant',
    },
    {
      name: 'zh-Hans-CN',
      languages: [language('zh', 'Hans', 'CN')],
      expected: 'zh-Hans',
    },
    {
      name: 'zh-HK without a script',
      languages: [language('zh', null, 'HK')],
      expected: 'zh-Hant',
    },
    {
      name: 'zh-CN without a script',
      languages: [language('zh', null, 'CN')],
      expected: 'zh-Hans',
    },
    {
      name: 'zh without a region',
      languages: [language('zh')],
      expected: 'zh-Hant',
    },
    { name: 'en-GB', languages: [language('en', null, 'GB')], expected: 'en' },
    {
      name: 'fr then zh-SG',
      languages: [language('fr', null, 'FR'), language('zh', null, 'SG')],
      expected: 'zh-Hans',
    },
  ] as const)('should map $name to $expected', ({ languages, expected }) => {
    jest
      .mocked(getLocales)
      .mockReturnValueOnce([languages[0], ...languages.slice(1)]);

    expect(deviceLocale()).toBe(expected);
  });

  it('should report no locale when the device prefers only unsupported languages', () => {
    jest.mocked(getLocales).mockReturnValueOnce([language('fr', null, 'FR')]);

    expect(deviceLocale()).toBeUndefined();
  });
});
