import { readFile } from 'node:fs/promises';

import { z } from 'zod';

import { composeApplication } from '../composition.js';

import { createLocalSettings } from './runtime.js';

import type { HttpResource } from './http/resources.js';

import type { ApplicationRuntime } from '../composition.js';
import type { ApplicationSettings } from '../configuration.js';

/** exposes authenticated HTTP and cleanup for an isolated API */
export interface HttpFixture {
  readonly runtime: ApplicationRuntime;
  readonly request: (
    ...args: [path: string, method?: string, body?: unknown, key?: string]
  ) => Promise<Response>;
  readonly close: () => Promise<void>;
}

/**
 * binds an in-process application to globally provisioned infrastructure
 * @param resource serializable database and private directory descriptors
 * @param settings selected provider settings kept within this worker
 * @returns authenticated transport and idempotent worker-pool cleanup
 * @throws {AggregateError} when authentication and worker cleanup both fail
 */
export async function createHttpFixture(
  resource: HttpResource,
  settings: ApplicationSettings = createLocalSettings(),
): Promise<HttpFixture> {
  const runtime = await composeApplication({
    ...settings,
    app: {
      ...settings.app,
      DATABASE_URL: resource.databaseUrl,
      ANTICA_DEV_OTP_INBOX: resource.inbox,
      ANTICA_STORAGE_LOCAL_ROOT: resource.storageRoot,
    },
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => (closing ??= runtime.close());
  try {
    const cookie = await authenticate(
      runtime,
      settings.app.ANTICA_COLLECTOR_PHONE,
      resource.inbox,
    );

    return {
      runtime: { ...runtime, close },
      request: createAuthenticatedRequest(runtime, cookie),
      close,
    };
  } catch (cause) {
    try {
      await close();
    } catch (cleanupCause) {
      throw new AggregateError(
        [cause, cleanupCause],
        'HTTP fixture setup and cleanup failed',
      );
    }
    throw cause;
  }
}

/**
 * obtains a session through the real development OTP transport
 * @param runtime isolated server composition
 * @param phoneNumber synthetic allowlisted collector
 * @param inbox private test OTP destination
 * @returns session cookie for HTTP requests
 */
async function authenticate(
  runtime: ApplicationRuntime,
  phoneNumber: string,
  inbox: string,
): Promise<string> {
  await runtime.app.request(
    'http://127.0.0.1:8080/api/auth/phone-number/send-otp',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber }),
    },
  );
  const { code } = z
    .object({ code: z.string() })
    .parse(JSON.parse((await readFile(inbox, 'utf8')).trim()));
  const verified = await runtime.app.request(
    'http://127.0.0.1:8080/api/auth/phone-number/verify',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ phoneNumber, code }),
    },
  );

  return verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}

/**
 * binds collector authentication to each test request
 * @param runtime isolated server composition
 * @param cookie verified collector session
 * @returns authenticated request operation
 */
function createAuthenticatedRequest(
  runtime: ApplicationRuntime,
  cookie: string,
): HttpFixture['request'] {
  return async (...[path, method = 'GET', body, key]) => {
    const headers = new Headers({
      cookie,
      'content-type': 'application/json',
    });
    if (key) {
      headers.set('idempotency-key', key);
    }

    return runtime.app.request(`http://127.0.0.1:8080${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
}
