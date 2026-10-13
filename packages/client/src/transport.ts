import { ApiError } from './api-error.js';

/** Provides a session cookie from the Better Auth Expo client. */
export interface SessionCookieProvider {
  getCookie(): Promise<string>;
  onUnauthorized(): void;
}

/** Configures the authenticated JSON transport. */
export interface ApiTransportConfig {
  baseUrl: string;
  session: SessionCookieProvider;
}

/** Options for an authenticated JSON command. */
export interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

interface JsonRequestOptions extends RequestOptions {
  method: 'GET' | 'POST' | 'PATCH';
}

/** Parses an API response into a domain contract. */
export interface JsonSchema<T> {
  parse(value: unknown): T;
}

const UNAUTHORIZED_STATUS = 401;

/** Sends authenticated JSON commands and validates server responses. */
export class ApiTransport {
  readonly #baseUrl: string;
  readonly #session: SessionCookieProvider;

  /**
   * Creates a transport bound to the configured API and session.
   * @param config API origin and session provider.
   */
  constructor(config: ApiTransportConfig) {
    this.#baseUrl = config.baseUrl.replace(/\/$/, '');
    this.#session = config.session;
  }

  /**
   * Reads and validates a JSON response.
   * @param path Relative endpoint path appended to the configured origin.
   * @param schema Response schema.
   * @param signal Optional cancellation signal.
   * @returns Parsed response.
   */
  public async get<T>(
    path: string,
    schema: JsonSchema<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#request(path, schema, { method: 'GET', signal });
  }

  /**
   * Posts an authenticated JSON command.
   * @param path Relative endpoint path appended to the configured origin.
   * @param schema Response schema.
   * @param options Command body, idempotency key, and signal.
   * @returns Parsed response.
   */
  public async post<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions,
  ): Promise<T> {
    return this.#request(path, schema, { ...options, method: 'POST' });
  }

  /**
   * Patches an authenticated JSON resource.
   * @param path Relative endpoint path appended to the configured origin.
   * @param schema Response schema.
   * @param options Command body, idempotency key, and signal.
   * @returns Parsed response.
   */
  public async patch<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions,
  ): Promise<T> {
    return this.#request(path, schema, { ...options, method: 'PATCH' });
  }

  /**
   * Uploads bytes directly to a signed URL.
   * @param url Signed upload URL.
   * @param bytes File bytes.
   * @param headers Signed request headers.
   * @returns The remote ETag, when provided.
   */
  public async putSigned(
    url: string,
    bytes: Blob,
    headers: Record<string, string>,
  ): Promise<string> {
    const response = await fetch(url, { method: 'PUT', headers, body: bytes });
    if (!response.ok) {
      throw new ApiError(
        response.status,
        'UPLOAD_FAILED',
        'The file upload failed.',
      );
    }

    return response.headers.get('etag') ?? '';
  }

  /**
   * Sends a cookie-authenticated JSON request and parses its response.
   * @param path Relative endpoint path.
   * @param schema Response contract.
   * @param options HTTP method, command options, and cancellation signal.
   * @returns Parsed response.
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
      throw new ApiError(response.status, error.code, error.message);
    }

    return schema.parse(await response.json());
  }
}

/**
 * Reads a public API error while preserving a safe fallback for malformed bodies.
 * @param value Decoded response body.
 * @returns Public code and message.
 */
function readPublicError(value: unknown): { code: string; message: string } {
  if (typeof value === 'object' && value !== null) {
    const candidate = value as Record<string, unknown>;
    const nested =
      typeof candidate.error === 'object' && candidate.error !== null
        ? (candidate.error as Record<string, unknown>)
        : candidate;
    if (typeof nested.code === 'string' && typeof nested.message === 'string') {
      return { code: nested.code, message: nested.message };
    }
  }

  return {
    code: 'REQUEST_FAILED',
    message: 'The request could not be completed.',
  };
}
