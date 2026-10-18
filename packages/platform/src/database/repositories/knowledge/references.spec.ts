import { describe, expect, it } from 'vitest';

import { resolvePointer } from './references.js';

describe('fn:resolvePointer', () => {
  it('should resolve root, escaped object keys and array indexes without traversing inherited properties', () => {
    const payload = { 'a/b': { '~name': ['first', null] }, 'terminal': 3 };
    expect(resolvePointer(payload, '')).toBe(payload);
    expect(resolvePointer(payload, '/a~1b/~0name/0')).toBe('first');
    expect(resolvePointer(payload, '/a~1b/~0name/1')).toBeNull();
    expect(resolvePointer(payload, '/a~1b/~0name/1/child')).toBeUndefined();
    expect(resolvePointer(payload, '/terminal/child')).toBeUndefined();
    expect(resolvePointer(payload, '/toString')).toBeUndefined();
    expect(resolvePointer(payload, '/missing')).toBeUndefined();
  });
});
