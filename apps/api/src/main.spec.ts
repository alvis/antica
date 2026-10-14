import { existsSync } from 'node:fs';
import { Server } from 'node:http';

import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Resolve the real startup dependencies before any case installs process-wide spies.
import '@antica/platform';
import '@antica/platform/ai';
import 'inngest/hono';

import type { ApplicationRuntime } from './composition.js';
import type { ApiEnv } from './http.js';
import type { ApplicationDrainReport } from './jobs.js';

const boundary = vi.hoisted(() => ({
  compose: vi.fn<(typeof import('./composition.js'))['composeApplication']>(),
  listen: vi.fn<(typeof import('@hono/node-server'))['serve']>(),
}));

vi.mock(
  'node:fs',
  async (importOriginal) =>
    ({
      ...(await importOriginal<typeof import('node:fs')>()),
      existsSync: vi.fn(() => false),
    }) satisfies Partial<typeof import('node:fs')>,
);
vi.mock(
  '@hono/node-server',
  () =>
    ({ serve: boundary.listen }) satisfies Partial<
      typeof import('@hono/node-server')
    >,
);
vi.mock('./composition.js', async () => {
  const { readApplicationConfig, readImageConfiguration } =
    await import('./configuration.js');

  return {
    readApplicationConfig,
    readImageConfiguration,
    composeApplication: boundary.compose,
  } satisfies Partial<typeof import('./composition.js')>;
});

const environment = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://antica@127.0.0.1:54329/unused_startup_test',
  BETTER_AUTH_URL: 'http://127.0.0.1:8080',
  BETTER_AUTH_SECRET: 'startup-test-auth-secret-at-least-32-characters',
  ANTICA_COLLECTOR_PHONE: '+447700900123',
  ANTICA_OTP_DRIVER: 'development',
  ANTICA_DEV_OTP_INBOX: '/nonexistent/antica-startup-test/inbox',
  ANTICA_STORAGE_DRIVER: 'local',
  ANTICA_STORAGE_LOCAL_ROOT: '/nonexistent/antica-startup-test/objects',
  ANTICA_STORAGE_SIGNING_SECRET: 'startup-test-storage-secret-32-characters',
  ANTICA_MODEL_DRIVER: 'development',
  ANTICA_IMAGE_SEARCH_DRIVER: 'local',
  ANTICA_PARSING_DRIVER: 'local',
  ANTICA_TEXT_SEARCH_DRIVER: 'local',
  ANTICA_WORKFLOW_DRIVER: 'local',
};
const originalExitCode = process.exitCode;
const originalArgv = process.argv;
const initialInterrupt = process.listeners('SIGINT');
const initialTerminate = process.listeners('SIGTERM');
const emptyReport: ApplicationDrainReport = {
  inspected: 0,
  settled: 0,
  deferred: 0,
  failures: [],
  webhooks: { inspected: 0, delivered: 0, deferred: 0 },
};

afterEach(async () => {
  // A timed-out test does not cancel its import or the startup catch continuation.
  await vi.dynamicImportSettled();
  for (const listener of process.listeners('SIGINT')) {
    if (!initialInterrupt.includes(listener)) {
      process.removeListener('SIGINT', listener);
    }
  }
  for (const listener of process.listeners('SIGTERM')) {
    if (!initialTerminate.includes(listener)) {
      process.removeListener('SIGTERM', listener);
    }
  }
  process.exitCode = originalExitCode;
  process.argv = originalArgv;
});

describe('cmd:api startup', { timeout: 30_000 }, () => {
  it.each([
    ['application', 'BETTER_AUTH_SECRET', 'short'],
    ['model configuration', 'ANTICA_MODEL_DRIVER', 'unknown'],
    ['model registry', 'ANTICA_MODEL_DRIVER', 'live'],
    ['image retrieval', 'ANTICA_IMAGE_SEARCH_DRIVER', 'unknown'],
    ['source retrieval', 'ANTICA_PARSING_DRIVER', 'unknown'],
    ['workflow', 'ANTICA_WORKFLOW_DRIVER', 'unknown'],
  ])(
    'should fail closed for invalid %s without opening resources',
    async (_, key, value) => {
      const harness = prepareStartup();
      vi.stubEnv(key, value);
      await import('./main.js');
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
      expect(harness.stderr.mock.calls).toEqual([
        [expect.stringContaining('"event":"api.startup_failed"')],
      ]);
      expect(boundary.compose).not.toHaveBeenCalled();
      expect(boundary.listen).not.toHaveBeenCalled();
    },
  );

  it('should load the optional environment file before serving readiness and close once for both signals', async () => {
    const harness = prepareStartup();
    vi.mocked(existsSync).mockReturnValueOnce(true);
    const load = vi
      .spyOn(process, 'loadEnvFile')
      .mockImplementation(() => undefined);
    await import('./main.js');
    await vi.waitFor(() => expect(boundary.listen).toHaveBeenCalledTimes(1));
    expect(load).toHaveBeenCalledOnce();
    expect(harness.stdout.mock.calls).toEqual([
      [expect.stringContaining('"event":"api.ready"')],
    ]);
    expect(await (await harness.app.request('/healthz')).json()).toEqual({
      status: 'ready',
    });
    process.emit('SIGINT');
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(harness.close).toHaveBeenCalledOnce());
    expect(harness.serverClose).toHaveBeenCalledOnce();
    expect(process.exitCode).toBeUndefined();
  });

  it.each(['success', 'failure', 'exception'] as const)(
    'should release the database after a one-shot drain %s',
    async (outcome) => {
      const harness = prepareStartup();
      process.argv = [...originalArgv, '--drain'];
      if (outcome === 'failure') {
        harness.drain.mockResolvedValueOnce({
          ...emptyReport,
          failures: [{ jobId: 'failed-job', code: 'JOB_FAILED' }],
        });
      }
      if (outcome === 'exception') {
        harness.drain.mockRejectedValueOnce(new Error('database unavailable'));
      }
      await import('./main.js');
      await vi.waitFor(() => expect(harness.close).toHaveBeenCalledOnce());
      expect(boundary.listen).not.toHaveBeenCalled();
      if (outcome === 'exception') {
        await vi.waitFor(() => expect(process.exitCode).toBe(1));
        expect(harness.stderr.mock.calls).toEqual([
          [expect.stringContaining('"event":"api.startup_failed"')],
        ]);
      } else {
        expect(harness.stdout.mock.calls).toEqual([
          [expect.stringContaining('"event":"jobs.drained"')],
        ]);
        expect(process.exitCode).toBe(outcome === 'failure' ? 1 : undefined);
      }
    },
  );

  it('should mount the signed workflow HTTP boundary for the selected runtime', async () => {
    const harness = prepareStartup();
    vi.stubEnv('ANTICA_WORKFLOW_DRIVER', 'inngest');
    vi.stubEnv('INNGEST_EVENT_KEY', 'test-event-key');
    vi.stubEnv('INNGEST_SIGNING_KEY', 'signkey-test-' + '0'.repeat(64));
    await import('./main.js');
    await vi.waitFor(() => expect(boundary.listen).toHaveBeenCalledOnce());
    const response = await harness.app.request('/api/inngest');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ function_count: 1 });
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(harness.close).toHaveBeenCalledOnce());
  });

  it.each(['listener', 'server close', 'database close'] as const)(
    'should report a failing exit and release resources on %s failure',
    async (failure) => {
      const harness = prepareStartup();
      if (failure === 'server close') {
        harness.serverClose.mockImplementationOnce((callback) => {
          callback?.(new Error('close failed'));

          return harness.server;
        });
      }
      if (failure === 'database close') {
        harness.close.mockRejectedValueOnce(new Error('pool close failed'));
      }
      await import('./main.js');
      await vi.waitFor(() => expect(boundary.listen).toHaveBeenCalledOnce());
      if (failure === 'listener') {
        harness.server.emit('error', new Error('address in use'));
      } else {
        process.emit('SIGTERM');
      }
      await vi.waitFor(() => expect(process.exitCode).toBe(1));
      expect(harness.close).toHaveBeenCalledOnce();
      if (failure === 'listener') {
        expect(harness.stderr.mock.calls).toEqual([
          [expect.stringContaining('"event":"api.listen_failed"')],
        ]);
      }
    },
  );
});

function prepareStartup() {
  vi.resetModules();
  for (const [key, value] of Object.entries(environment)) {
    vi.stubEnv(key, value);
  }
  process.exitCode = undefined;
  const stdout = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(() => true);
  const stderr = vi
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true);
  const app = new Hono<ApiEnv>();
  app.get('/healthz', (context) => context.json({ status: 'ready' }));
  const close = vi.fn(async () => undefined);
  const drain = vi.fn(async (): Promise<ApplicationDrainReport> => emptyReport);
  const server = new Server();
  const serverClose = vi
    .spyOn(server, 'close')
    .mockImplementation((callback) => {
      callback?.();

      return server;
    });
  const runtime = { app, close, drain } satisfies Partial<ApplicationRuntime>;
  boundary.compose.mockResolvedValueOnce(
    runtime as Partial<ApplicationRuntime> as ApplicationRuntime,
  );
  boundary.listen.mockImplementationOnce((_options, ready) => {
    ready?.({ address: '127.0.0.1', family: 'IPv4', port: 8080 });

    return server;
  });

  return { app, close, drain, server, serverClose, stdout, stderr };
}
