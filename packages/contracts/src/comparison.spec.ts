import { describe, expect, it } from 'vitest';

import { imageComparisonResultSchema } from './comparison.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('comparison result validation', () => {
  it('should accept a completed comparison with no model invocation', () => {
    const comparison = {
      value: {
        comparisonId: id,
        queryAnchorId: id,
        selected: { kind: 'collection', recordId: id, originalAssetId: id },
        selectedRegion: null,
        selectedCanonicalViewId: null,
        similaritiesZhHant: [],
        differencesZhHant: [],
        limitsZhHant: [],
        citations: [],
      },
      invocation: null,
    };

    expect(imageComparisonResultSchema.safeParse(comparison).success).toBe(
      true,
    );
    expect(
      imageComparisonResultSchema.safeParse({
        ...comparison,
        value: {
          ...comparison.value,
          selected: { kind: 'collection', recordId: id },
        },
      }).success,
    ).toBe(false);
  });
});
