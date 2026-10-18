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

  it('should accept the retryable in-progress failure of a request that is still running', () => {
    expect(
      publicErrorSchema.parse({
        code: 'REQUEST_IN_PROGRESS',
        message: 'Another request with this key is in progress',
        retryable: true,
        requestId: 'request-2',
      }),
    ).toMatchObject({ code: 'REQUEST_IN_PROGRESS', retryable: true });
  });
});

describe('resumed upload failures', () => {
  it.for(['UPLOAD_ALREADY_COMPLETED', 'UPLOAD_EXPIRED', 'UPLOAD_STORED'])(
    'should accept the stable %s code a resuming client branches on',
    (code) => {
      expect(
        publicErrorSchema.parse({
          code,
          message: 'Upload cannot be resumed',
          retryable: false,
          requestId: 'request-3',
        }),
      ).toMatchObject({ code });
    },
  );
});
