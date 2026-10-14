import type { OperationResult } from '../../ports/index.js';

/**
 * creates a public source failure with retryability derived from its code
 * @param code public source failure category
 * @param message safe user-facing explanation
 * @returns failed operation result
 */
export function failure(
  code:
    | 'VALIDATION_FAILED'
    | 'FORBIDDEN'
    | 'UPLOAD_INCOMPLETE'
    | 'MEDIA_UNSUPPORTED'
    | 'SOURCE_UNAVAILABLE'
    | 'NOT_FOUND'
    | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
