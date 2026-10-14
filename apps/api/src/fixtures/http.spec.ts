import { readFile } from 'node:fs/promises';

import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { composeApplication } from '../composition.js';

import { createHttpFixture } from './http.js';

import type { ApplicationRuntime } from '../composition.js';
import type { ApiEnv } from '../http.js';

const boundary = vi.hoisted(() => ({
  close: vi.fn<ApplicationRuntime['close']>(async () => {}),
}));

vi.mock(
  'node:fs/promises',
  () =>
    ({
      readFile: vi.fn<
        (...args: Parameters<typeof readFile>) => ReturnType<typeof readFile>
      >(async () => '{"code":"123456"}') as typeof readFile,
    }) satisfies Partial<typeof import('node:fs/promises')>,
);
vi.mock(
  '../composition.js',
  () =>
    ({
      composeApplication: vi.fn<typeof composeApplication>(async () => {
        const app: ApplicationRuntime['app'] = new Hono<ApiEnv>();
        app
          .post('/api/auth/phone-number/send-otp', (context) =>
            context.json({ sent: true }),
          )
          .post('/api/auth/phone-number/verify', (context) => {
            context.header('set-cookie', 'session=synthetic; HttpOnly');
            context.header('set-cookie', 'locale=en; Path=/', {
              append: true,
            });

            return context.json({ verified: true });
          })
          .all('/probe', async (context) =>
            context.json({
              method: context.req.method,
              cookie: context.req.header('cookie'),
              key: context.req.header('idempotency-key') ?? null,
              body: await context.req.text(),
            }),
          );
        const runtime = {
          app,
          close: boundary.close,
        } satisfies Partial<ApplicationRuntime>;

        return runtime as Partial<ApplicationRuntime> as ApplicationRuntime;
      }),
    }) satisfies Partial<typeof import('../composition.js')>,
);

const resource = {
  databaseUrl: 'postgres://localhost/antica_owned_test',
  directory: '/private/test-owned-fixture',
  inbox: '/private/test-owned-fixture/otp',
  storageRoot: '/private/test-owned-fixture/objects',
};

describe('fn:createHttpFixture', () => {
  it('should close the acquired pool when authentication fails', async () => {
    const failure = new Error('OTP inbox unavailable');
    vi.mocked(readFile).mockRejectedValueOnce(failure);

    await expect(createHttpFixture(resource)).rejects.toBe(failure);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should retain authentication and pool cleanup failures together', async () => {
    const authenticationFailure = new Error('OTP inbox unavailable');
    const cleanupFailure = new Error('Pool close unavailable');
    vi.mocked(readFile).mockRejectedValueOnce(authenticationFailure);
    boundary.close.mockRejectedValueOnce(cleanupFailure);

    await expect(createHttpFixture(resource)).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [authenticationFailure, cleanupFailure],
    });
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should share a rejected pool close without releasing the pool twice', async () => {
    const fixture = await createHttpFixture(resource);
    const failure = new Error('Pool close unavailable');
    boundary.close.mockRejectedValueOnce(failure);

    const closing = fixture.close();

    expect(fixture.runtime.close()).toBe(closing);
    await expect(closing).rejects.toBe(failure);
    await expect(fixture.close()).rejects.toBe(failure);
    expect(boundary.close.mock.calls).toEqual([[]]);
  });

  it('should authenticate requests and share one idempotent pool close', async () => {
    const fixture = await createHttpFixture(resource);

    const getResponse = await fixture.request('/probe');
    const postResponse = await fixture.request(
      '/probe',
      'POST',
      { title: 'test' },
      'receipt-1',
    );
    const closing = fixture.close();

    expect(fixture.runtime.close()).toBe(closing);
    await closing;
    await fixture.close();
    expect(await getResponse.json()).toEqual({
      method: 'GET',
      cookie: 'session=synthetic; locale=en',
      key: null,
      body: '',
    });
    expect(await postResponse.json()).toEqual({
      method: 'POST',
      cookie: 'session=synthetic; locale=en',
      key: 'receipt-1',
      body: '{"title":"test"}',
    });
    expect(boundary.close.mock.calls).toEqual([[]]);
    expect(vi.mocked(composeApplication).mock.calls).toEqual([
      [
        expect.objectContaining({
          app: expect.objectContaining({
            DATABASE_URL: resource.databaseUrl,
            ANTICA_DEV_OTP_INBOX: resource.inbox,
            ANTICA_STORAGE_LOCAL_ROOT: resource.storageRoot,
          }),
        }),
      ],
    ]);
  });
});
