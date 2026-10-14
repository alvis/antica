import type { PublicError } from '@antica/contracts';

/** public operation outcome that keeps expected failures in the return contract */
export type OperationResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly error: Omit<PublicError, 'requestId'>;
      /** internal failure context retained outside the public error shape */
      readonly cause?: unknown;
    };
