import { describe, expect, it } from 'vitest';

import { researchRequestSchema } from './discovery.js';

const id = '00000000-0000-4000-8000-000000000001';

describe('research request validation', () => {
  it('should require a concrete research instruction', () => {
    const request = {
      requestKey: id,
      instructionZhHant: 'Research the mark',
      scope: 'curated_only',
      recordId: null,
      entryId: null,
      sourceIds: [],
      preferNamedAuthors: true,
    };

    expect(researchRequestSchema.safeParse(request).success).toBe(true);
    expect(
      researchRequestSchema.safeParse({ ...request, instructionZhHant: '  ' })
        .success,
    ).toBe(false);
  });
});
