import { describe, expect, it } from 'vitest';

import { containsQuote, hasContent, resolvePointer } from './evidence.js';

import type { CanonicalJson } from '@antica/contracts';

describe('fn:resolvePointer', () => {
  const captured = { 'a/b': { '~mark': ['quoted value', null] }, 'empty': '' };

  it('should resolve RFC 6901 escaped keys, arrays, and the root', () => {
    expect(resolvePointer(captured, '/a~1b/~0mark/0')).toBe('quoted value');
    expect(resolvePointer(captured, '')).toEqual(captured);
    expect(resolvePointer(captured, '/a~1b/~0mark/1')).toBeNull();
  });

  it('should reject malformed escapes, inherited keys, and noncanonical array indices', () => {
    expect(resolvePointer(captured, 'a/b')).toBeUndefined();
    expect(resolvePointer(captured, '/a~2b')).toBeUndefined();
    expect(resolvePointer(captured, '/toString')).toBeUndefined();
    expect(resolvePointer(captured, '/a~1b/~0mark/01')).toBeUndefined();
    expect(resolvePointer(captured, '/a~1b/~0mark/5')).toBeUndefined();
    expect(resolvePointer(captured, '/empty/missing')).toBeUndefined();
  });
});

describe('fn:hasContent', () => {
  it('should reject absent and empty evidence but accept nested text and numeric facts', () => {
    const empty: Array<CanonicalJson | undefined> = [
      undefined,
      null,
      '',
      '  ',
      [],
      {},
      { nested: [] },
    ];
    expect(empty.map(hasContent)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect([0, false, { nested: ['evidence'] }].map(hasContent)).toEqual([
      true,
      true,
      true,
    ]);
  });
});

describe('fn:containsQuote', () => {
  it('should find a verbatim quote in captured leaves and ignore absent text', () => {
    const captured = {
      labels: ['bronze', { description: 'A cast inscription' }],
      missing: null,
      count: 3,
    };
    expect(containsQuote(captured, 'cast inscription')).toBe(true);
    expect(containsQuote(captured, 'Cast inscription')).toBe(false);
    expect(containsQuote(captured, '3')).toBe(true);
    expect(containsQuote(null, 'null')).toBe(false);
  });
});
