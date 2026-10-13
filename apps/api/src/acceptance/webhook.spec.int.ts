import { createHmac, randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createDatabase, createTransactionPort } from '@antica/platform';

import { createLlamaWebhookReceiver, drainLlamaWebhooks } from '../webhook.js';

import type { OperationResult } from '@antica/application/ports';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}

describe('Signed persistent Llama callbacks', () => {
  it('should retain an early verified event, reject tampering and expiry, then deliver once through its trusted owner mapping', async () => {
    const database = createDatabase({ url: databaseUrl });
    const secret = 'acceptance-webhook-signing-secret';
    const now = (): string => '2026-10-13T00:00:00.000Z';
    const eventId = randomUUID();
    const providerJobId = randomUUID();
    const ownerId = randomUUID();
    const jobId = randomUUID();
    const step = `parse:${randomUUID()}`;
    const payload = {
      event_id: eventId,
      event_type: 'parse.completed',
      timestamp: Date.parse(now()) / 1000,
      data: { job_id: providerJobId, owner_id: randomUUID() },
    };
    const body = JSON.stringify(payload);
    const receiver = createLlamaWebhookReceiver(database.db, secret, now);
    const sourceHandler = vi.fn(
      async (
        _ownerId: string,
        _jobId: string,
      ): Promise<OperationResult<void>> => ({ success: true, data: undefined }),
    );
    const drain = async () =>
      drainLlamaWebhooks(
        database.db,
        async (mappedOwner, mappedJob) =>
          mappedOwner === ownerId && mappedJob === jobId
            ? sourceHandler(mappedOwner, mappedJob)
            : {
                success: false,
                error: {
                  code: 'PROVIDER_UNAVAILABLE',
                  message: 'Other test owns this pending callback',
                  retryable: true,
                },
              },
        now,
      );
    const signedRequest = (raw: string): Request =>
      new Request('http://localhost:8080/v1/webhooks/llama', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'LC-Signature': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
        },
        body: raw,
      });
    try {
      const altered = signedRequest(body);
      altered.headers.set('LC-Signature', `sha256=${'0'.repeat(64)}`);
      expect((await receiver(altered)).status).toBe(401);
      const expired = JSON.stringify({
        ...payload,
        timestamp: payload.timestamp - 86_401,
      });
      expect((await receiver(signedRequest(expired))).status).toBe(401);
      const accepted = await receiver(signedRequest(body));
      expect(accepted.status).toBe(202);
      expect(await accepted.json()).toEqual({ accepted: true, replay: false });
      expect(await (await receiver(signedRequest(body))).json()).toEqual({
        accepted: true,
        replay: true,
      });
      expect(
        (
          await receiver(
            signedRequest(
              JSON.stringify({ ...payload, event_type: 'parse.failed' }),
            ),
          )
        ).status,
      ).toBeGreaterThanOrEqual(400);
      await drain();
      expect(sourceHandler).not.toHaveBeenCalled();

      await createTransactionPort(database.db).run(ownerId, async (unit) => {
        await unit.jobs.create({
          id: jobId,
          kind: 'sourceIngestion',
          resourceId: randomUUID(),
          state: { kind: 'waiting', stage: 'parse' },
          createdAt: now(),
          updatedAt: now(),
          result: null,
        });
        await unit.jobs.mapProviderJob(
          'llama-parse',
          providerJobId,
          jobId,
          step,
        );

        return { success: true, data: undefined };
      });
      expect(await drain()).toMatchObject({ delivered: 0 });
      expect(sourceHandler).toHaveBeenCalledExactlyOnceWith(ownerId, jobId);
      await createTransactionPort(database.db).run(ownerId, async (unit) => {
        await unit.jobs.updateStep(
          {
            jobId,
            step,
            revision: 1,
            state: 'completed',
            leaseUntil: null,
            checkpoint: null,
            result: null,
          },
          0,
        );

        return { success: true, data: undefined };
      });
      expect(await drain()).toMatchObject({ delivered: 1 });
      expect(sourceHandler).toHaveBeenCalledTimes(2);
      await receiver(signedRequest(body));
      await drain();
      expect(sourceHandler).toHaveBeenCalledTimes(2);
    } finally {
      await database.close();
    }
  });
});
