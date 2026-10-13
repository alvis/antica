import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { z } from 'zod';

import { createDatabase, migrateDatabase } from '@antica/platform/database';

import { composeApplication } from '../composition.js';

import { createLocalSettings } from './runtime.js';

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
 * starts a real API with a database and OTP inbox unique to this invocation
 * @param settings selected provider settings for the isolated runtime
 * @returns authenticated transport and deterministic resource cleanup
 */
export async function createHttpFixture(
  settings: ApplicationSettings = createLocalSettings(),
): Promise<HttpFixture> {
  const baseUrl = z.url().parse(process.env.ANTICA_TEST_DATABASE_URL);
  const databaseName = `antica_api_${randomUUID().replaceAll('-', '')}`;
  const admin = createDatabase({ url: baseUrl, maxConnections: 1 });
  await admin.db.execute(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  await migrateDatabase({ url: url.toString() });
  const directory = await mkdtemp(join(tmpdir(), 'antica-api-http-'));
  const inbox = join(directory, 'otp');
  const runtime = await composeApplication({
    ...settings,
    app: {
      ...settings.app,
      DATABASE_URL: url.toString(),
      ANTICA_DEV_OTP_INBOX: inbox,
      ANTICA_STORAGE_LOCAL_ROOT: join(directory, 'objects'),
    },
  });
  const cookie = await authenticate(
    runtime,
    settings.app.ANTICA_COLLECTOR_PHONE,
    inbox,
  );

  return {
    runtime,
    request: createAuthenticatedRequest(runtime, cookie),
    close: async () => {
      await runtime.close();
      await admin.db.execute(`DROP DATABASE "${databaseName}"`);
      await admin.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
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
