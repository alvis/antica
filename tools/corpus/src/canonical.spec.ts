import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256 } from './canonical.js';

describe('fn:canonicalJson', () => {
  it('should sort nested keys while preserving array order and Unicode text', () => {
    expect(canonicalJson({ z: ['中文', { b: 2, a: 1 }], a: true })).toBe(
      '{"a":true,"z":["中文",{"a":1,"b":2}]}',
    );
  });

  it('should serialize null and reject values outside JSON', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(() => canonicalJson(undefined)).toThrow('Expected a JSON value');
  });
});

describe('fn:sha256', () => {
  it('should hash the original UTF-8 bytes including newlines', () => {
    expect(sha256('中文\n')).toBe(
      'a20758305f24aa08fdd593d564de930e95c652027327bd291c5559db3d03f76c',
    );
    expect(sha256('中文')).not.toBe(sha256('中文\n'));
  });
});
