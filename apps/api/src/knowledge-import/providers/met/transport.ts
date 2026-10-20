import { setTimeout } from 'node:timers/promises';

import { KnowledgeProviderError } from '@antica/contracts';

interface RequestQueue {
  tail: Promise<void>;
  startedAt: number;
}

/** represents consumed metadata, never an image response */
export interface MetResponse {
  readonly status: number;
  readonly etag: string | null;
  readonly body: unknown;
}

/** identifies one approved API request */
export interface MetRequest {
  readonly url: URL;
  readonly signal: AbortSignal;
  readonly etag?: string;
}

const queuesByRequest = new WeakMap<typeof fetch, RequestQueue>();
const intervalMs = 1_000;
const httpRateLimited = 429;
const httpNotModified = 304;
const httpNotFound = 404;
const httpServerError = 500;
const httpRequestTimeout = 408;
const maximumResponseBytes = 2_097_152;
const userAgent =
  'Antica/1.0 (Metropolitan Museum of Art knowledge import; metadata and image URLs only)';

/**
 * shares one serial one-request-per-second queue across provider instances
 * @param request HTTP capability, shared by all production instances
 * @returns consumed metadata request function
 */
export function createMetTransport(
  request: typeof fetch,
): (params: MetRequest) => Promise<MetResponse> {
  const queue = queuesByRequest.get(request) ?? {
    tail: Promise.resolve(),
    startedAt: -Infinity,
  };
  queuesByRequest.set(request, queue);

  return async (params) => {
    const pending = queue.tail.then(async () => {
      params.signal.throwIfAborted();
      const delayMs = Math.max(0, queue.startedAt + intervalMs - Date.now());
      await setTimeout(delayMs, undefined, { signal: params.signal });

      return fetchMetadata(request, params, queue);
    });
    // a failed delivery releases the queue; retries belong to the durable framework
    queue.tail = pending.then(
      () => undefined,
      () => undefined,
    );

    return pending;
  };
}

/**
 * consumes a metadata response before releasing the shared provider queue
 * @param request HTTP capability
 * @param params approved URL, cancellation and conditional token
 * @param queue shared request start clock
 * @returns parsed metadata or an upstream status with no body
 * @throws {KnowledgeProviderError} when upstream rejects or oversizes the response
 */
async function fetchMetadata(
  request: typeof fetch,
  params: MetRequest,
  queue: RequestQueue,
): Promise<MetResponse> {
  const headers = new Headers({
    'Accept': 'application/json',
    'User-Agent': userAgent,
  });
  if (params.etag) {
    headers.set('If-None-Match', params.etag);
  }
  queue.startedAt = Date.now();
  const response = await request(params.url, {
    headers,
    signal: params.signal,
    redirect: 'error',
  });
  const text = await response.text();
  if (response.status === httpRateLimited) {
    throw new KnowledgeProviderError({
      code: 'RATE_LIMITED',
      retryable: true,
      retryAfter: response.headers.get('Retry-After') ?? undefined,
    });
  }
  if (
    response.status !== httpNotModified &&
    response.status !== httpNotFound &&
    !response.ok
  ) {
    throw new KnowledgeProviderError({
      code: `UPSTREAM_HTTP_${response.status}`,
      retryable:
        response.status >= httpServerError ||
        response.status === httpRequestTimeout,
    });
  }
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new KnowledgeProviderError({
      code: 'OBJECT_TOO_LARGE',
      retryable: false,
    });
  }

  return {
    status: response.status,
    etag: response.headers.get('ETag'),
    body:
      response.status === httpNotModified || response.status === httpNotFound
        ? null
        : (JSON.parse(text) as unknown),
  };
}
