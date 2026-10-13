/** Represents an API error with a stable HTTP status and public code. */
export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  /**
   * Creates an error from a public API response.
   * @param status HTTP status.
   * @param code Public error code.
   * @param message Public error message.
   */
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
