import { describe, expect, it, vi } from 'vitest';

import { createInngestWorkflow, readWorkflowConfiguration } from './runtime.js';

const { register } = vi.hoisted(() => ({
  register: vi.fn(
    (
      _options: unknown,
      handler: (context: {
        step: {
          run: (
            id: string,
            callback: () => Promise<unknown>,
          ) => Promise<unknown>;
        };
      }) => Promise<unknown>,
    ) => ({ handler }),
  ),
}));
vi.mock('inngest', () => ({
  Inngest: class {
    public createFunction = register;
  },
}));

describe('fn:readWorkflowConfiguration', () => {
  it.each([
    {},
    { ANTICA_WORKFLOW_DRIVER: 'local', NODE_ENV: 'production' },
    { ANTICA_WORKFLOW_DRIVER: 'inngest', INNGEST_EVENT_KEY: 'private-event' },
    {
      ANTICA_WORKFLOW_DRIVER: 'inngest',
      INNGEST_SIGNING_KEY: 'private-signing',
    },
  ])('should reject unconfigured or production-local execution: %j', (env) => {
    const result = readWorkflowConfiguration(env);
    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
    expect(JSON.stringify(result)).not.toContain('private-event');
    expect(JSON.stringify(result)).not.toContain('private-signing');
  });

  it('should accept explicit local development and fully signed production execution', () => {
    expect(
      readWorkflowConfiguration({ ANTICA_WORKFLOW_DRIVER: 'local' }),
    ).toEqual({ success: true, data: { driver: 'local' } });
    expect(
      readWorkflowConfiguration({
        ANTICA_WORKFLOW_DRIVER: 'inngest',
        NODE_ENV: 'production',
        INNGEST_EVENT_KEY: 'event-key',
        INNGEST_SIGNING_KEY: 'signing-key',
      }),
    ).toMatchObject({
      success: true,
      data: { driver: 'inngest', production: true },
    });
  });
});

describe('fn:createInngestWorkflow', () => {
  it('should schedule the durable drain through one named SDK step without running during registration', async () => {
    const drain = vi.fn(async () => ({ inspected: 3, settled: 3 }));
    createInngestWorkflow(
      {
        driver: 'inngest',
        production: true,
        eventKey: 'event-key',
        signingKey: 'signing-key',
      },
      drain,
    );
    expect(drain).not.toHaveBeenCalled();
    const registration = register.mock.calls.at(-1)!;
    expect(registration[0]).toMatchObject({
      concurrency: { limit: 1 },
      triggers: [{ cron: '* * * * *' }, { event: 'antica/jobs.drain' }],
    });
    const run = vi.fn(async (_id: string, callback: () => Promise<unknown>) =>
      callback(),
    );
    expect(await registration[1]({ step: { run } })).toEqual({
      inspected: 3,
      settled: 3,
    });
    expect(run).toHaveBeenCalledWith('drain-persisted-outbox', drain);
    expect(drain).toHaveBeenCalledTimes(1);
  });
});
