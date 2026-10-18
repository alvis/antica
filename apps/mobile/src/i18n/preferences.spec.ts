import { describe, expect, it, jest } from '@jest/globals';

import {
  parseLocalPreferences,
  readLocalPreferences,
  resolveInterfaceLocale,
  setInterfaceLanguage,
} from './preferences';

import type { LocalPreferencesPort } from './preferences';

describe('fn:resolveInterfaceLocale', () => {
  it.each(['zh-Hant', 'zh-Hans', 'en'] as const)(
    'should keep the explicit %s choice whatever the device reports',
    (choice) => {
      expect(resolveInterfaceLocale(choice, ['ja-JP', 'zh-CN'])).toEqual({
        preference: choice,
        locale: choice,
        usedSystemFallback: false,
      });
    },
  );

  it.each([
    { tags: ['zh-Hant-TW'], expected: 'zh-Hant' },
    { tags: ['zh-Hant-CN'], expected: 'zh-Hant' },
    { tags: ['zh-Hans-HK'], expected: 'zh-Hans' },
    { tags: ['zh-Hans'], expected: 'zh-Hans' },
    { tags: ['zh-TW'], expected: 'zh-Hant' },
    { tags: ['zh-HK'], expected: 'zh-Hant' },
    { tags: ['zh-MO'], expected: 'zh-Hant' },
    { tags: ['zh-CN'], expected: 'zh-Hans' },
    { tags: ['zh-SG'], expected: 'zh-Hans' },
    { tags: ['zh_cn'], expected: 'zh-Hans' },
    { tags: ['zh'], expected: 'zh-Hant' },
    { tags: ['zh-u-nu-hans'], expected: 'zh-Hant' },
    { tags: ['zh-x-cn'], expected: 'zh-Hant' },
    { tags: ['zh-TW-u-ca-roc'], expected: 'zh-Hant' },
    { tags: ['zh-Hans-u-sg'], expected: 'zh-Hans' },
    { tags: ['en'], expected: 'en' },
    { tags: ['en-GB'], expected: 'en' },
    { tags: ['EN-us'], expected: 'en' },
    { tags: ['fr-FR', 'yue-HK', 'zh-SG', 'en-US'], expected: 'zh-Hans' },
    { tags: ['ja-JP', 'en-AU', 'zh-TW'], expected: 'en' },
  ])(
    'should follow the first supported device language in $tags',
    ({ tags, expected }) => {
      expect(resolveInterfaceLocale('system', tags)).toEqual({
        preference: 'system',
        locale: expected,
        usedSystemFallback: false,
      });
    },
  );

  it.each([{ tags: ['fr-FR', 'ar-EG'] }, { tags: [] }])(
    'should fall back to Traditional Chinese when $tags has no supported language',
    ({ tags }) => {
      expect(resolveInterfaceLocale('system', tags)).toEqual({
        preference: 'system',
        locale: 'zh-Hant',
        usedSystemFallback: true,
      });
    },
  );
});

describe('fn:parseLocalPreferences', () => {
  it.each(['zh-Hant', 'zh-Hans', 'en', 'system'] as const)(
    'should accept a version-1 %s choice',
    (interfaceLanguage) => {
      expect(
        parseLocalPreferences({ schemaVersion: 1, interfaceLanguage }),
      ).toEqual({ schemaVersion: 1, interfaceLanguage });
    },
  );

  it.each([
    {
      name: 'an unsupported language',
      value: { schemaVersion: 1, interfaceLanguage: 'fr' },
    },
    {
      name: 'a path-like value',
      value: { schemaVersion: 1, interfaceLanguage: '../en' },
    },
    {
      name: 'another schema version',
      value: { schemaVersion: 2, interfaceLanguage: 'en' },
    },
    { name: 'a missing language', value: { schemaVersion: 1 } },
    { name: 'a bare string', value: 'en' },
    { name: 'null', value: null },
  ])('should reject $name', ({ value }) => {
    expect(parseLocalPreferences(value)).toBeNull();
  });
});

describe('op:readLocalPreferences', () => {
  it('should use Traditional Chinese when nothing is stored', async () => {
    const port = { read: async () => null, write: async () => undefined };

    expect(await readLocalPreferences(port)).toEqual({
      schemaVersion: 1,
      interfaceLanguage: 'zh-Hant',
    });
  });

  it('should return the stored choice', async () => {
    const stored = { schemaVersion: 1, interfaceLanguage: 'system' } as const;
    const port = { read: async () => stored, write: async () => undefined };

    expect(await readLocalPreferences(port)).toEqual(stored);
  });
});

describe('op:setInterfaceLanguage', () => {
  it('should store the complete versioned object before returning it', async () => {
    const port = {
      read: async () => null,
      write: jest.fn<LocalPreferencesPort['write']>(async () => undefined),
    };

    const result = await setInterfaceLanguage(port, 'zh-Hans');

    expect(port.write.mock.calls).toEqual([
      [{ schemaVersion: 1, interfaceLanguage: 'zh-Hans' }],
    ]);
    expect(result).toEqual({ schemaVersion: 1, interfaceLanguage: 'zh-Hans' });
  });

  it('should report a failed write instead of success', async () => {
    const failure = new Error('Keychain unavailable.');
    const port = {
      read: async () => null,
      write: async () => {
        throw failure;
      },
    };

    await expect(setInterfaceLanguage(port, 'en')).rejects.toBe(failure);
  });
});
