import { describe, expect, it } from '@jest/globals';

import { isLocale, locales, resources } from './resources';

/**
 * lists the interpolation placeholders a text uses
 * @param text dictionary text
 * @returns sorted placeholder names
 */
function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map(([, name]) => name).sort();
}

const source = resources['zh-Hant'].translation;
const sourceKeys = Object.keys(source).sort();

describe('fn:dictionaries', () => {
  it('should offer Traditional Chinese, Simplified Chinese, and English', () => {
    expect(locales).toEqual(['zh-Hant', 'zh-Hans', 'en']);
    expect(locales.every(isLocale)).toBe(true);
    expect(isLocale('zh')).toBe(false);
  });

  it.each(locales)(
    'should give %s exactly the Traditional Chinese keys',
    (locale) => {
      expect(Object.keys(resources[locale].translation).sort()).toEqual(
        sourceKeys,
      );
    },
  );

  it.each(locales)('should leave no %s text empty', (locale) => {
    const empty = Object.entries(resources[locale].translation)
      .filter(([, text]) => text.trim() === '')
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it.each(locales)('should interpolate the same values in %s', (locale) => {
    const translation: Readonly<Record<string, string>> =
      resources[locale].translation;
    const mismatched = sourceKeys.filter(
      (key) =>
        placeholders(translation[key]).join() !==
        placeholders((source as Readonly<Record<string, string>>)[key]).join(),
    );

    expect(mismatched).toEqual([]);
  });

  it('should write Simplified Chinese apart from Traditional Chinese', () => {
    const simplified = resources['zh-Hans'].translation;

    expect(simplified.messages).toBe('消息');
    expect(simplified.whatsappLogin).toBe('使用 WhatsApp 登录');
    expect(simplified.video).toBe('视频');
    expect(simplified.import).toBe('导入文件');
    expect(simplified.settings).toBe('设置');
  });
});
