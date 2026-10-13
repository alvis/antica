import { describe, expect, it } from 'vitest';

import { scoreRetrieval } from './metrics.js';

describe('fn:scoreRetrieval', () => {
  it('should measure graded ranking independently from inference quality', () => {
    const result = scoreRetrieval({
      rankedIds: ['irrelevant', 'relevant'],
      relevance: { relevant: 3, missing: 1 },
      limit: 2,
    });

    expect(result.recallAtK).toBe(0.5);
    expect(result.normalizedDiscountedCumulativeGain).toBeCloseTo(
      7 / Math.log2(3) / (7 + 1 / Math.log2(3)),
    );
  });

  it('should leave unjudgeable queries unscored', () => {
    expect(scoreRetrieval({ rankedIds: [], relevance: {}, limit: 3 })).toEqual({
      recallAtK: null,
      normalizedDiscountedCumulativeGain: null,
    });
  });

  it('should stop scoring at the cutoff and exclude irrelevant labels', () => {
    expect(
      scoreRetrieval({
        rankedIds: ['best', 'other'],
        relevance: { best: 2, other: 0 },
        limit: 1,
      }),
    ).toEqual({ recallAtK: 1, normalizedDiscountedCumulativeGain: 1 });
  });

  it('should reject duplicated candidates instead of crediting a repeated hit twice', () => {
    expect(() =>
      scoreRetrieval({
        rankedIds: ['best', 'best'],
        relevance: { best: 3 },
        limit: 2,
      }),
    ).toThrow(RangeError);
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'should reject invalid cutoff %s',
    (limit) => {
      expect(() =>
        scoreRetrieval({ rankedIds: [], relevance: {}, limit }),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, 4, Number.POSITIVE_INFINITY, Number.NaN])(
    'should reject invalid relevance grade %s',
    (grade) => {
      expect(() =>
        scoreRetrieval({ rankedIds: [], relevance: { item: grade }, limit: 1 }),
      ).toThrow(RangeError);
    },
  );
});
