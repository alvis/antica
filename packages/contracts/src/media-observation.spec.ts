import { describe, expect, it } from 'vitest';

import { checkResultSchema } from './media-observation.js';

describe('check result validation', () => {
  it('should require a reason for an undetermined inspection', () => {
    expect(
      checkResultSchema.safeParse({
        kind: 'undetermined',
        reason: 'View blocked',
      }).success,
    ).toBe(true);
    expect(
      checkResultSchema.safeParse({ kind: 'undetermined', reason: '  ' })
        .success,
    ).toBe(false);
  });
});
