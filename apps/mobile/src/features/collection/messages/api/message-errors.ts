import { ApiError } from '@antica/client';

import type { ErrorCode } from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

/** translated explanation for each public error code the message area can meet */
const codeKeys: Partial<Record<string, MessageKey>> = {
  REVISION_CONFLICT: 'messageStale',
  REQUEST_IN_PROGRESS: 'requestInProgress',
  VALIDATION_FAILED: 'requestInvalid',
  EVIDENCE_INVALID: 'requestInvalid',
  NOT_FOUND: 'notFoundError',
  RATE_LIMITED: 'rateLimited',
  AUTH_REQUIRED: 'signInAgain',
  FORBIDDEN: 'signInAgain',
  PROVIDER_UNAVAILABLE: 'serviceUnavailable',
  JOB_FAILED: 'serviceUnavailable',
  UPLOAD_INCOMPLETE: 'uploadFailed',
  MEDIA_UNSUPPORTED: 'uploadFailed',
} satisfies Partial<Record<ErrorCode, MessageKey>>;

/**
 * explains a failed request in the collector's language instead of showing server text
 * @param cause value thrown by the transport or an adapter
 * @param t translation function for message keys
 * @param overrides screen-specific keys that replace the default for a code
 * @returns a translated, user-facing explanation
 */
export function describeMessageError(
  cause: unknown,
  t: (key: MessageKey) => string,
  overrides: Partial<Record<string, MessageKey>> = {},
): string {
  if (!(cause instanceof ApiError)) {
    // React Native's fetch reports a lost connection as a TypeError
    return t(cause instanceof TypeError ? 'offline' : 'error');
  }

  return t(overrides[cause.code] ?? codeKeys[cause.code] ?? 'error');
}

/**
 * tells whether a failure means the request was built from data the server has since changed
 * @param cause value thrown by the transport
 * @returns true for a revision conflict
 */
export function isRevisionConflict(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'REVISION_CONFLICT';
}

/**
 * tells whether the server is still handling an earlier request under the same key
 * @param cause value thrown by the transport
 * @returns true when the same request key may be retried later
 */
export function isRequestInProgress(cause: unknown): boolean {
  return cause instanceof ApiError && cause.code === 'REQUEST_IN_PROGRESS';
}
