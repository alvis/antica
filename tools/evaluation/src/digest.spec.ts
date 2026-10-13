import { describe, expect, it } from 'vitest';

import { digestSnapshot } from './digest.js';

describe('fn:digestSnapshot', () => {
  it('should bind nested snapshot content independently from JSON key insertion order', () => {
    expect(digestSnapshot({ z: [{ b: null, a: '原文' }], a: 1 })).toBe(
      digestSnapshot({ a: 1, z: [{ a: '原文', b: null }] }),
    );
    expect(digestSnapshot({ images: ['first', 'second'] })).not.toBe(
      digestSnapshot({ images: ['second', 'first'] }),
    );
  });
});
