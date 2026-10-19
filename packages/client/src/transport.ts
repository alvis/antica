import { ApiError } from './api-error.js';

/** session cookie access through the Better Auth Expo client */
export interface SessionCookieProvider {
  getCookie(): Promise<string>;
  onUnauthorized(): void;
}

/** configuration for authenticated JSON transport */
export interface ApiTransportConfig {
  baseUrl: string;
  session: SessionCookieProvider;
}

/** options for an authenticated JSON command */
export interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

interface JsonRequestOptions extends RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
}

/** API response parser for a domain contract */
export interface JsonSchema<T> {
  parse(value: unknown): T;
}

const UNAUTHORIZED_STATUS = 401;

/** authenticated JSON command transport with response validation */
export class ApiTransport {
  readonly #baseUrl: string;
  readonly #session: SessionCookieProvider;

  /**
   * creates a transport bound to the configured API and session
   * @param config API origin and session provider
   */
  constructor(config: ApiTransportConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
    this.#session = config.session;
  }

  /**
   * reads and validates a JSON response
   * @param path relative endpoint path appended to the configured origin
   * @param schema response schema
   * @param signal optional cancellation signal
   * @returns parsed response
   */
  public async get<T>(
    path: string,
    schema: JsonSchema<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#request(path, schema, { method: 'GET', signal });
  }

  /**
   * posts an authenticated JSON command
   * @param path relative endpoint path appended to the configured origin
   * @param schema response schema
   * @param options command body, idempotency key, and signal
   * @returns parsed response
   */
  public async post<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions,
  ): Promise<T> {
    return this.#request(path, schema, { ...options, method: 'POST' });
  }

  /**
   * patches an authenticated JSON resource
   * @param path relative endpoint path appended to the configured origin
   * @param schema response schema
   * @param options command body, idempotency key, and signal
   * @returns parsed response
   */
  public async patch<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions,
  ): Promise<T> {
    return this.#request(path, schema, { ...options, method: 'PATCH' });
  }

  /**
   * uploads bytes directly to a signed URL
   * @param url signed upload URL
   * @param bytes file bytes
   * @param headers signed request headers
   * @returns the remote ETag, when provided
   * @throws ApiError when the signed upload response is unsuccessful
   */
  public async putSigned(
    url: string,
    bytes: Blob,
    headers: Record<string, string>,
  ): Promise<string> {
    const response = await fetch(url, { method: 'PUT', headers, body: bytes });
    if (!response.ok) {
      throw new ApiError({
        status: response.status,
        code: 'UPLOAD_FAILED',
        message: 'The file upload failed.',
      });
    }

    return response.headers.get('etag') ?? '';
  }

  /**
   * sends a cookie-authenticated JSON request and parses its response
   * @param path relative endpoint path
   * @param schema response contract
   * @param options HTTP method, command options, and cancellation signal
   * @returns parsed response
   * @throws ApiError when the authenticated response is unsuccessful
   */
  async #request<T>(
    path: string,
    schema: JsonSchema<T>,
    options: JsonRequestOptions,
  ): Promise<T> {
    const cookie = await this.#session.getCookie();
    const response = await fetch(`${this.#baseUrl}${path}`, {
      method: options.method,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Cookie': cookie,
        ...(options.idempotencyKey
          ? { 'Idempotency-Key': options.idempotencyKey }
          : {}),
      },
      body:
        options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
    if (response.status === UNAUTHORIZED_STATUS) {
      this.#session.onUnauthorized();
    }
    if (!response.ok) {
      const content = await response.json().catch((): unknown => null);
      const error = readPublicError(content);
      throw new ApiError({
        status: response.status,
        code: error.code,
        message: error.message,
        retryable: error.retryable,
      });
    }

    return schema.parse(await response.json());
  }
}

/**
 * reads a public API error while preserving a safe fallback for malformed bodies
 * @param value decoded response body
 * @returns public code, message, and whether the server marked the failure retryable
 */
function readPublicError(value: unknown): {
  code: string;
  message: string;
  retryable: boolean;
} {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const nested =
      typeof candidate.error === 'object' && candidate.error !== null
        ? (candidate.error as Record<string, unknown>)
        : candidate;
    if (typeof nested.code === 'string' && typeof nested.message === 'string') {
      return {
        code: nested.code,
        message: nested.message,
        retryable: nested.retryable === true,
      };
    }
  }

  return {
    code: 'REQUEST_FAILED',
    message: 'The request could not be completed.',
    retryable: false,
  };
}
