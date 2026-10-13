import { describe, expect, it } from 'vitest';

import { evaluateImages } from './images.js';

describe('fn:evaluateImages', () => {
  it('should rank actual fixture pixels rather than matching asset identifiers', async () => {
    const report = await evaluateImages();
    expect(report).toMatchObject({
      adapterKind: 'development',
      metric: 'rgb-grid-distance',
      rankedIds: ['40000000-0000-4000-8000-000000000002'],
      scores: { recallAtK: 1, normalizedDiscountedCumulativeGain: 1 },
      error: null,
    });
  });
});
