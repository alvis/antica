import type { PublicError } from '@antica/contracts';

export type OperationResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly error: Omit<PublicError, 'requestId'>;
      readonly cause?: unknown;
    };
