import { Hono } from 'hono';

import { describe, expect, it, vi } from 'vitest';

import { createInngestWorkflow } from '@antica/platform';

import { serve } from 'inngest/hono';

describe('Signed Inngest boundary', () => {
  it('should reject an unsigned production invocation before draining persistent jobs', async () => {
    const drain = vi.fn(async () => ({ inspected: 0, settled: 0 }));
    const workflow = createInngestWorkflow(
      {
        driver: 'inngest',
        production: true,
        eventKey: 'test-event-key',
        signingKey:
          'signkey-test-0000000000000000000000000000000000000000000000000000000000000000',
      },
      drain,
    );
    const app = new Hono();
    app.on(
      ['GET', 'POST', 'PUT'],
      '/api/inngest',
      serve({ ...workflow, servePath: '/api/inngest' }),
    );
    const response = await app.request(
      '/api/inngest?fnId=antica-persisted-outbox-drain&stepId=step',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          event: { name: 'antica/jobs.drain', data: {} },
        }),
      },
    );
    expect(response.status).toBe(401);
    expect(drain).not.toHaveBeenCalled();
  });
});
