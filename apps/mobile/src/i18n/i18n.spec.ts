import { describe, expect, it, jest } from '@jest/globals';

import { createI18n } from './i18n';

const developmentBuild = __DEV__;

/**
 * looks up a key that no dictionary type declares
 * @param i18n instance whose dictionaries are searched
 * @param key text key absent from the typed dictionaries
 * @returns the translation or i18next's missing-key result
 */
function translateUndeclared(
  i18n: ReturnType<typeof createI18n>,
  key: string,
): string {
  return (i18n.t as (key: string) => string)(key);
}

describe('fn:createI18n', () => {
  it('should fall back to Traditional Chinese for a key missing from another locale', () => {
    const i18n = createI18n('en');
    i18n.addResource('zh-Hant', 'translation', 'onlyTraditional', '僅繁體');

    expect(translateUndeclared(i18n, 'onlyTraditional')).toBe('僅繁體');
    expect(i18n.t('settings')).toBe('Settings');
  });

  it('should report a key no dictionary carries by name only in development builds', () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    translateUndeclared(createI18n('en'), 'absentKey');

    expect(warn.mock.calls).toEqual([
      ['Missing interface translation key.', 'absentKey'],
    ]);
  });

  it('should stay silent about missing keys in release builds', () => {
    Reflect.set(globalThis, '__DEV__', false);
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    try {
      translateUndeclared(createI18n('en'), 'absentKey');
    } finally {
      Reflect.set(globalThis, '__DEV__', developmentBuild);
    }

    expect(warn).not.toHaveBeenCalled();
  });
});
