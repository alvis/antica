import { ApiError, ApiTransport } from '@antica/client';

import type {
  ApiTransportConfig,
  JsonSchema,
  RequestOptions,
} from '@antica/client';

/** authentication recovery bound to the mobile cookie storage */
type MobileTransportConfig = ApiTransportConfig & {
  /** discards cached storage before the one permitted retry */
  refreshCookie: () => void;
  /** session epoch binds both attempts and expiry to the initiating collector */
  getSessionVersion: () => number;
};

const unauthorized = 401;

/**
 * authenticated mobile transport that recovers a rotated cookie once on rejection
 * retries POST/PATCH safely because the API's /v1/* middleware rejects unauthorized requests before route side effects
 */
export class MobileApiTransport extends ApiTransport {
  readonly #baseUrl: string;
  readonly #getCookie: ApiTransportConfig['session']['getCookie'];
  readonly #refreshCookie: () => void;
  readonly #expire: () => void;
  readonly #getSessionVersion: () => number;

  /**
   * binds cookie recovery without expiring the session before its retry
   * @param config API origin, cookie reader, invalidation and final expiry
   */
  constructor(config: MobileTransportConfig) {
    super(config);
    this.#baseUrl = config.baseUrl;
    this.#getCookie = async () => config.session.getCookie();
    this.#refreshCookie = config.refreshCookie;
    this.#getSessionVersion = config.getSessionVersion;
    this.#expire = () => config.session.onUnauthorized();
  }

  /**
   * reads with one cookie recovery attempt
   * @param path relative API endpoint
   * @param schema response parser
   * @param signal cancellation signal
   * @returns parsed response
   */
  public override async get<T>(
    path: string,
    schema: JsonSchema<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return this.#recover(async (transport) =>
      transport.get(path, schema, signal),
    );
  }

  /**
   * writes with one cookie recovery attempt
   * @param path relative API endpoint
   * @param schema response parser
   * @param options command body, identity and cancellation
   * @returns parsed response
   */
  public override async post<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.#recover(async (transport) =>
      transport.post(path, schema, options),
    );
  }

  /**
   * writes with one cookie recovery attempt
   * @param path relative API endpoint
   * @param schema response parser
   * @param options command body, identity and cancellation
   * @returns parsed response
   */
  public override async patch<T>(
    path: string,
    schema: JsonSchema<T>,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.#recover(async (transport) =>
      transport.patch(path, schema, options),
    );
  }

  /**
   * retries only a rejected session; all other failures retain their original behavior
   * @param request original request with its command identity preserved
   * @returns parsed response after at most one recovery attempt
   */
  async #recover<T>(
    request: (transport: ApiTransport) => Promise<T>,
  ): Promise<T> {
    const version = this.#getSessionVersion();
    let hadCookie = false;
    const carriedCookie = (): boolean => hadCookie;
    const transport = new ApiTransport({
      baseUrl: this.#baseUrl,
      session: {
        getCookie: async () => {
          const cookie = await this.#getCookie();
          hadCookie = Boolean(cookie);

          return cookie;
        },
        onUnauthorized: () => undefined,
      },
    });
    try {
      return await request(transport);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== unauthorized) {
        throw error;
      }
      if (!carriedCookie() || this.#getSessionVersion() !== version) {
        throw error;
      }
      this.#refreshCookie();
      try {
        return await request(transport);
      } catch (retryError) {
        if (
          retryError instanceof ApiError &&
          retryError.status === unauthorized &&
          carriedCookie() &&
          this.#getSessionVersion() === version
        ) {
          this.#expire();
        }
        throw retryError;
      }
    }
  }
}
