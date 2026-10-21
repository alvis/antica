import { describe, expect, it } from '@jest/globals';

import { translator } from '../i18n/translate.spec.fixtures';

import { quoteFields } from './quote-fields';

describe('fn:quoteFields', () => {
  it('should quote one field on its own', () => {
    expect(quoteFields(['名稱'], translator('zh-Hant'))).toBe('「名稱」');
  });

  it('should join the last two fields with and, as the assistant says them', () => {
    expect(quoteFields(['名稱', '材質'], translator('zh-Hant'))).toBe(
      '「名稱」與「材質」',
    );
    expect(quoteFields(['名稱', '年代', '材質'], translator('zh-Hant'))).toBe(
      '「名稱」、「年代」與「材質」',
    );
  });

  it('should say nothing for no fields', () => {
    expect(quoteFields([], translator('en'))).toBe('');
  });
});
