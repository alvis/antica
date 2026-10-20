import { describe, expect, it } from 'vitest';

import { canonicalHash, canonicalJson, projectionId } from './canonical.js';

describe('fn:canonicalJson', () => {
  it('should normalize nested key order without changing arrays or primitive values', () => {
    expect(
      canonicalJson({
        z: [null, false, 3, 'text'],
        a: { y: 2, x: 1 },
        omitted: undefined,
      }),
    ).toBe('{"a":{"x":1,"y":2},"z":[null,false,3,"text"]}');
    expect(canonicalHash({ a: 1, b: 2 })).toBe(canonicalHash({ b: 2, a: 1 }));
    expect(canonicalHash([1, 2])).not.toBe(canonicalHash([2, 1]));
  });
});

describe('fn:projectionId', () => {
  it('should retain one UUID per revision identity while separating later revisions', () => {
    expect(projectionId('entry:1:claim')).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
    );
    expect(projectionId('entry:1:claim')).toBe(projectionId('entry:1:claim'));
    expect(projectionId('entry:1:claim')).not.toBe(
      projectionId('entry:2:claim'),
    );
  });
});
