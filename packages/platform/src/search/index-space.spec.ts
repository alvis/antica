import { describe, expect, it } from 'vitest';

import { validateIndexSpace } from './index-space.js';

import type { IndexIdentity } from '@antica/application/ports';

const expected: IndexIdentity = {
  embeddingModelId: 'embed:v1',
  dimensions: 384,
  indexVersion: 'index-1',
};

describe('fn:validateIndexSpace', () => {
  it('should query a separately loaded index with the same embedding identity', () => {
    expect(validateIndexSpace(expected, { ...expected })).toEqual({
      valid: true,
    });
  });

  it('should reject a new model even when vector dimensions match', () => {
    expect(
      validateIndexSpace(expected, {
        ...expected,
        embeddingModelId: 'embed:v2',
      }),
    ).toMatchObject({ valid: false });
  });

  it('should reject an incompatible vector dimension before retrieval', () => {
    expect(
      validateIndexSpace(expected, { ...expected, dimensions: 768 }),
    ).toMatchObject({ valid: false });
  });

  it('should reject a stale index version after the accepted alias switches', () => {
    expect(
      validateIndexSpace(expected, { ...expected, indexVersion: 'index-2' }),
    ).toMatchObject({ valid: false });
  });
});
