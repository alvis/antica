import { describe, expect, it } from 'vitest';

import {
  analyzeSearchQuery,
  normalizeSearchText,
  tokenizeSearchText,
} from './tokenizer.js';

describe('fn:normalizeSearchText', () => {
  it('should fold compatibility forms, case and accents without converting Han script', () => {
    expect(normalizeSearchText('ＣＡＦÉ 釉裡紅 釉里红')).toBe(
      'cafe 釉裡紅 釉里红',
    );
  });
});

describe('fn:tokenizeSearchText', () => {
  it('should preserve domain phrases and English words for multilingual discovery', () => {
    expect(
      tokenizeSearchText('青花 釉裡紅 黃花梨 榫卯 沁色 款識 CAFÉ'),
    ).toMatchObject({
      tokens: expect.arrayContaining([
        '青花',
        '釉裡紅',
        '黃花梨',
        '榫卯',
        '沁色',
        '款識',
        'cafe',
      ]),
      bigrams: expect.arrayContaining(['釉裡', '裡紅', '黃花', '花梨']),
    });
  });

  it('should keep traditional and simplified terms distinct', () => {
    expect(tokenizeSearchText('釉裡紅').tokens).not.toContain('釉里红');
    expect(tokenizeSearchText('釉里红').tokens).not.toContain('釉裡紅');
  });

  it('should discard punctuation and avoid bigrams across word boundaries', () => {
    expect(tokenizeSearchText('青，花！  123')).toEqual({
      tokens: ['青', '花', '123'],
      bigrams: [],
    });
    expect(tokenizeSearchText('  !😀 ')).toEqual({ tokens: [], bigrams: [] });
  });

  it('should deduplicate repeated tokens and bigrams', () => {
    const result = tokenizeSearchText('青花青花 青花');
    expect(result.tokens.filter((token) => token === '青花')).toHaveLength(1);
    expect(result.bigrams.filter((token) => token === '青花')).toHaveLength(1);
  });
});

describe('fn:analyzeSearchQuery', () => {
  it('should remove Chinese and English question words only from queries', () => {
    const text =
      '如何 是否 館藏 證據 與 的 how what which whether museum record evidence 青花 bronze';
    expect(analyzeSearchQuery(text).tokens).toEqual(['青花', 'bronze']);
    expect(tokenizeSearchText(text).tokens).toEqual(
      expect.arrayContaining([
        '如何',
        '是否',
        'how',
        'museum',
        'evidence',
        '青花',
        'bronze',
      ]),
    );
  });

  it('should preserve quoted marks and domain phrases as whole meaningful tokens', () => {
    expect(
      analyzeSearchQuery('如何比較「大明成化年製」與釉裡紅的資料？').tokens,
    ).toEqual(['大明成化年製', '釉裡紅']);
  });

  it('should retain quoted stop words while discarding unquoted stop-only input', () => {
    expect(analyzeSearchQuery('what "museum record" evidence').tokens).toEqual([
      'museum record',
    ]);
    expect(analyzeSearchQuery('如何 與 的 whether evidence')).toEqual({
      tokens: [],
      bigrams: [],
    });
  });
});
