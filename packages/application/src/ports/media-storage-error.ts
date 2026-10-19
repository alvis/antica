/** a definite verification outcome rather than a storage availability failure */
export interface OriginalVerificationErrorParams {
  readonly reason: 'absent' | 'mismatch';
  readonly message: string;
  readonly cause?: unknown;
}

/** distinguishes absent or mismatched originals from failures to inspect storage */
export class OriginalVerificationError extends Error {
  public readonly reason: OriginalVerificationErrorParams['reason'];

  /** retains the definite verification outcome and its optional storage cause */
  constructor({ reason, message, cause }: OriginalVerificationErrorParams) {
    super(message, { cause });
    this.name = 'OriginalVerificationError';
    this.reason = reason;
  }
}
