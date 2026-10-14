/** public error identity, HTTP status, and safe message */
export interface ApiErrorParams {
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

/** represents an API error with a stable HTTP status and public code */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  /**
   * creates an error from a public API response
   * @param params HTTP status, public code, and safe message
   */
  constructor(params: ApiErrorParams) {
    const { status, code, message } = params;
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
