import { describe, expect, it } from '@jest/globals';

import { ApiError } from '@antica/client';

import {
  describeMessageError,
  isRequestInProgress,
  isRevisionConflict,
} from './message-errors';

import type { MessageKey } from '../../../../i18n/messages';

const t = (key: MessageKey): string => `t:${key}`;
const failure = (code: string): ApiError =>
  new ApiError({ status: 400, code, message: `server text for ${code}` });

describe('fn:describeMessageError', () => {
  it('should translate a known code instead of showing the server text', () => {
    expect(describeMessageError(failure('RATE_LIMITED'), t)).toBe(
      't:rateLimited',
    );
  });

  it('should let a screen replace the explanation of a code', () => {
    expect(
      describeMessageError(failure('REVISION_CONFLICT'), t, {
        REVISION_CONFLICT: 'changeStale',
      }),
    ).toBe('t:changeStale');
  });

  it('should fall back to the generic text for an unknown code', () => {
    expect(describeMessageError(failure('SOMETHING_NEW'), t)).toBe('t:error');
  });

  it('should call a lost connection offline and anything else a generic failure', () => {
    expect(
      describeMessageError(new TypeError('Network request failed'), t),
    ).toBe('t:offline');
    expect(describeMessageError(new Error('boom'), t)).toBe('t:error');
  });
});

describe('fn:isRevisionConflict', () => {
  it('should recognise only a revision conflict from the API', () => {
    expect(isRevisionConflict(failure('REVISION_CONFLICT'))).toBe(true);
    expect(isRevisionConflict(failure('REQUEST_IN_PROGRESS'))).toBe(false);
    expect(isRevisionConflict(new Error('REVISION_CONFLICT'))).toBe(false);
  });
});

describe('fn:isRequestInProgress', () => {
  it('should recognise only a request the server is still handling', () => {
    expect(isRequestInProgress(failure('REQUEST_IN_PROGRESS'))).toBe(true);
    expect(isRequestInProgress(failure('REVISION_CONFLICT'))).toBe(false);
    expect(isRequestInProgress(new Error('REQUEST_IN_PROGRESS'))).toBe(false);
  });
});
