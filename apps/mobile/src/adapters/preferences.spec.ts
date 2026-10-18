import { describe, expect, it, jest } from '@jest/globals';

import { deleteItemAsync, getItemAsync, setItemAsync } from 'expo-secure-store';

import { readLocalPreferences } from '../i18n/preferences';

import { devicePreferences } from './preferences';

jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();

  return {
    getItemAsync: jest.fn(
      async (key: string): Promise<string | null> => values.get(key) ?? null,
    ),
    setItemAsync: jest.fn(async (key: string, value: string): Promise<void> => {
      values.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string): Promise<void> => {
      values.delete(key);
    }),
  } satisfies Partial<typeof import('expo-secure-store')>;
});

describe('cp:devicePreferences', () => {
  it('should store the versioned object under its own key and read it back', async () => {
    await devicePreferences.write({
      schemaVersion: 1,
      interfaceLanguage: 'system',
    });

    expect(await getItemAsync('antica.preferences.v1')).toBe(
      '{"schemaVersion":1,"interfaceLanguage":"system"}',
    );
    expect(await devicePreferences.read()).toEqual({
      schemaVersion: 1,
      interfaceLanguage: 'system',
    });
  });

  it.each([
    { name: 'malformed JSON', stored: '{"schemaVersion":' },
    {
      name: 'an unsupported language',
      stored: '{"schemaVersion":1,"interfaceLanguage":"de"}',
    },
    {
      name: 'a future schema',
      stored: '{"schemaVersion":2,"interfaceLanguage":"en"}',
    },
  ])('should treat $name as no saved choice', async ({ stored }) => {
    await setItemAsync('antica.preferences.v1', stored);

    expect(await devicePreferences.read()).toBeNull();
  });

  it.each([
    {
      key: 'antica.preferences.v1',
      value: '{"schemaVersion":1,"interfaceLanguage":"zh-Hans"}',
    },
    { key: 'antica.locale', value: 'zh-Hans' },
  ])(
    'should read a retired language from $key as Traditional Chinese',
    async ({ key, value }) => {
      await deleteItemAsync('antica.preferences.v1');
      await deleteItemAsync('antica.locale');
      await setItemAsync(key, value);

      expect(await readLocalPreferences(devicePreferences)).toEqual({
        schemaVersion: 1,
        interfaceLanguage: 'zh-Hant',
      });
    },
  );

  it('should report a new installation as having no saved choice', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(null);

    expect(await devicePreferences.read()).toBeNull();
  });

  it('should move a language saved by an earlier build into the versioned object', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(null);
    await setItemAsync('antica.locale', 'en');

    expect(await devicePreferences.read()).toEqual({
      schemaVersion: 1,
      interfaceLanguage: 'en',
    });
    expect(await getItemAsync('antica.preferences.v1')).toBe(
      '{"schemaVersion":1,"interfaceLanguage":"en"}',
    );
    expect(await getItemAsync('antica.locale')).toBeNull();
  });

  it('should keep an earlier language and its key when the migrated copy cannot be written', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(null);
    await setItemAsync('antica.locale', 'zh-Hant');
    jest
      .mocked(setItemAsync)
      .mockRejectedValueOnce(new Error('Keychain locked.'));

    expect(await devicePreferences.read()).toEqual({
      schemaVersion: 1,
      interfaceLanguage: 'zh-Hant',
    });
    expect(await getItemAsync('antica.locale')).toBe('zh-Hant');
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });

  it('should read a migrated language even when the earlier key cannot be removed', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(null);
    await setItemAsync('antica.locale', 'en');
    jest
      .mocked(deleteItemAsync)
      .mockRejectedValueOnce(new Error('Keychain locked.'));

    expect(await devicePreferences.read()).toEqual({
      schemaVersion: 1,
      interfaceLanguage: 'en',
    });
    expect(await getItemAsync('antica.preferences.v1')).toBe(
      '{"schemaVersion":1,"interfaceLanguage":"en"}',
    );
  });

  it('should ignore an unsupported language saved by an earlier build', async () => {
    jest.mocked(getItemAsync).mockResolvedValueOnce(null);
    await setItemAsync('antica.locale', 'fr');

    expect(await devicePreferences.read()).toBeNull();
  });
});
