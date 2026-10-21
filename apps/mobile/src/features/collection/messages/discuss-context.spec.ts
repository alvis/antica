import { describe, expect, it } from '@jest/globals';

import { splitDiscussContext, withDiscussContext } from './discuss-context';

describe('fn:withDiscussContext', () => {
  it('should prefix the message with the discussed suggestion on its own line', () => {
    expect(withDiscussContext('討論建議 · 年代：宋', '為什麼？')).toBe(
      '〔討論建議 · 年代：宋〕\n為什麼？',
    );
  });

  it('should strip brackets from the context so the prefix stays parseable', () => {
    expect(withDiscussContext('年代：〔宋〕', '')).toBe('〔年代：宋〕');
  });
});

describe('fn:splitDiscussContext', () => {
  it('should round-trip a discussed message back to its context and text', () => {
    expect(
      splitDiscussContext(
        withDiscussContext('討論建議 · 年代：宋', '為什麼？'),
      ),
    ).toEqual({
      context: '討論建議 · 年代：宋',
      text: '為什麼？',
    });
  });

  it('should round-trip a context-only message to empty text', () => {
    expect(splitDiscussContext(withDiscussContext('年代：宋', ''))).toEqual({
      context: '年代：宋',
      text: '',
    });
  });

  it('should leave a plain or unclosed message untouched', () => {
    expect(splitDiscussContext('hello')).toEqual({ text: 'hello' });
    expect(splitDiscussContext('〔unclosed')).toEqual({ text: '〔unclosed' });
  });
});
