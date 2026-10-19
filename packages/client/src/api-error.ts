/** public error identity, HTTP status, and safe message */
export interface ApiErrorParams {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** whether the server marked the failure as worth retrying; absent means no */
  readonly retryable?: boolean;
}

/** represents an API error with a stable HTTP status and public code */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly retryable: boolean;

  /**
   * creates an error from a public API response
   * @param params HTTP status, public code, safe message, and the server's retry hint
   */
  constructor(params: ApiErrorParams) {
    const { status, code, message, retryable = false } = params;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
