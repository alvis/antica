import { describe, expect, it } from 'vitest';

import { publicErrorSchema } from './error.js';

describe('public error validation', () => {
  it('should accept a public failure and reject an unknown error code', () => {
    const error = {
      code: 'REVISION_CONFLICT',
      message: 'The record changed',
      retryable: false,
      requestId: 'request-1',
    };

    expect(publicErrorSchema.safeParse(error).success).toBe(true);
    expect(
      publicErrorSchema.safeParse({ ...error, code: 'INTERNAL' }).success,
    ).toBe(false);
  });
});
