import { createHash, createHmac, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  sourceAcceptedSchema,
  sourceDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';
import {
  collectorUserId,
  readKnowledgeConfiguration,
  recordVerifiedProviderWebhook,
} from '@antica/platform';

import { createHttpFixture } from './fixtures/http.js';
import { createLocalSettings } from './fixtures/runtime.js';
import { createLlamaWebhookReceiver, drainLlamaWebhooks } from './webhook.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
const secret = 'webhook-http-test-signing-secret';
const now = (): string => '2026-10-13T00:00:00.000Z';
const event = {
  event_id: randomUUID(),
  event_type: 'parse.completed',
  timestamp: Date.parse(now()) / 1000,
  data: { job_id: randomUUID() },
};

beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('fn:createLlamaWebhookReceiver', () => {
  it('should reject configuration without a signing secret', () => {
    expect(() =>
      createLlamaWebhookReceiver(fixture.runtime.database.db, '', now),
    ).toThrow();
  });

  it.each([
    'null',
    'true',
    '{}',
    '{',
    JSON.stringify({ ...event, event_id: '' }),
    JSON.stringify({ ...event, event_type: '' }),
    JSON.stringify({ ...event, timestamp: 'invalid' }),
    JSON.stringify(event).replace(String(event.timestamp), '1e309'),
    JSON.stringify({ ...event, data: null }),
    JSON.stringify({ ...event, data: 'invalid' }),
    JSON.stringify({ ...event, data: { job_id: '' } }),
    JSON.stringify({ ...event, data: { job_id: 12 } }),
  ])('should reject a signed malformed event: %s', async (body) => {
    const receiver = createLlamaWebhookReceiver(
      fixture.runtime.database.db,
      secret,
      now,
    );
    const response = await receiver(signedRequest(body));
    expect(response.status).toBe(422);
  });

  it('should reject an empty request and an oversized stream without recording an event', async () => {
    const receiver = createLlamaWebhookReceiver(
      fixture.runtime.database.db,
      secret,
      now,
    );
    expect(
      (
        await receiver(
          new Request('http://localhost/callback', { method: 'POST' }),
        )
      ).status,
    ).toBe(401);
    const response = await receiver(signedRequest('x'.repeat(1_048_577)));
    expect(response.status).toBe(413);
  });

  it('should refuse events when the verification clock is unavailable', async () => {
    const receiver = createLlamaWebhookReceiver(
      fixture.runtime.database.db,
      secret,
      () => 'invalid date',
    );
    expect((await receiver(signedRequest(JSON.stringify(event)))).status).toBe(
      401,
    );
  });

  it('should defer unrelated and failed callbacks and let only one concurrent drain acknowledge completed work', async () => {
    const database = fixture.runtime.database.db;
    const jobId = randomUUID();
    const step = `parse:${randomUUID()}`;
    const providerJobId = randomUUID();
    await fixture.runtime.transaction.run(collectorUserId, async (unit) => {
      await unit.jobs.create({
        id: jobId,
        kind: 'sourceIngestion',
        resourceId: randomUUID(),
        state: { kind: 'waiting', stage: 'parse' },
        createdAt: now(),
        updatedAt: now(),
        result: null,
      });
      await unit.jobs.mapProviderJob('llama-parse', providerJobId, jobId, step);
      await unit.jobs.mapProviderJob(
        'llama-parse',
        'unrelated-step',
        jobId,
        'index:checkpoint',
      );
      await unit.jobs.mapProviderJob(
        'other-provider',
        'other-job',
        jobId,
        step,
      );

      return { success: true, data: undefined };
    });
    for (const [provider, mappedId] of [
      ['llama-parse', providerJobId],
      ['llama-parse', 'unrelated-step'],
      ['other-provider', 'other-job'],
    ] as const) {
      await recordVerifiedProviderWebhook(database, {
        provider,
        providerJobId: mappedId,
        eventId: randomUUID(),
        eventType: 'parse.completed',
        signedAt: now(),
        payloadHash: 'ab'.repeat(32),
        payload: {},
      });
    }
    expect(
      await drainLlamaWebhooks(
        database,
        async () => ({
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Retry provider',
            retryable: true,
          },
        }),
        now,
      ),
    ).toEqual({ inspected: 3, delivered: 0, deferred: 3 });
    expect(
      await drainLlamaWebhooks(
        database,
        async () => {
          throw new Error('Provider disconnected');
        },
        now,
      ),
    ).toEqual({ inspected: 3, delivered: 0, deferred: 3 });
    await fixture.runtime.transaction.run(collectorUserId, async (unit) => {
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
    const drained = await Promise.all(
      [0, 1].map(async () =>
        drainLlamaWebhooks(
          database,
          async () => ({ success: true, data: undefined }),
          now,
        ),
      ),
    );
    expect(drained.reduce((total, result) => total + result.delivered, 0)).toBe(
      1,
    );
    expect(
      await drainLlamaWebhooks(
        database,
        async () => {
          throw new Error('Unrelated callbacks must not dispatch');
        },
        now,
      ),
    ).toEqual({ inspected: 2, delivered: 0, deferred: 2 });
  });

  it('should count one durable delivery when two real source callback drains race', async () => {
    const knowledge = readKnowledgeConfiguration({
      ANTICA_PARSING_DRIVER: 'llama',
      ANTICA_TEXT_SEARCH_DRIVER: 'local',
      LLAMA_CLOUD_API_KEY: 'synthetic-test-key',
      LLAMA_PARSE_VERSION: '2026-09-01',
      LLAMA_WEBHOOK_URL: 'https://api.example.test/webhooks/llama-parse',
      LLAMA_WEBHOOK_SIGNING_SECRET: 'synthetic-webhook-signing-secret',
    });
    if (!knowledge.success) {
      throw new Error('Invalid parser fixture config');
    }
    const raceFixture = await createHttpFixture({
      ...createLocalSettings(),
      knowledge: knowledge.data,
    });
    try {
      const providerJobId = randomUUID();
      const uploadedOriginals: Uint8Array[] = [];
      const transport = vi.fn<typeof fetch>(async (...args) => {
        if (args[0] === 'data:,') {
          return new Response();
        }
        const request = new Request(...args);
        if (request.method === 'POST') {
          const form = await request.formData();
          const file = form.get('file');
          if (!(file instanceof File)) {
            throw new Error('Expected original parse upload');
          }
          uploadedOriginals.push(new Uint8Array(await file.arrayBuffer()));

          return Response.json({ id: providerJobId, status: 'PENDING' });
        }

        return Response.json({
          job: { id: providerJobId, status: 'COMPLETED' },
          text: { pages: [{ page_number: 1, text: 'Retained glaze text' }] },
        });
      });
      vi.stubGlobal('fetch', transport);
      const intakeKey = randomUUID();
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
        'base64',
      );
      const upload = uploadSessionSchema.parse(
        await (
          await raceFixture.request('/v1/media/uploads', 'POST', {
            requestKey: randomUUID(),
            target: { kind: 'source_intake', intakeKey },
            kind: 'photo',
            purpose: 'book_page',
            componentIds: [],
            fileName: 'page.png',
            mimeType: 'image/png',
            byteLength: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          })
        ).json(),
      );
      if (upload.mode !== 'single') {
        throw new Error('Expected local single upload');
      }
      expect(
        (
          await raceFixture.runtime.app.request(upload.putUrl, {
            method: 'PUT',
            headers: upload.headers,
            body: bytes,
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await raceFixture.request(
            `/v1/media/${upload.assetId}/complete`,
            'POST',
            {
              requestKey: randomUUID(),
            },
          )
        ).status,
      ).toBe(200);
      expect(await raceFixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const registered = await raceFixture.request('/v1/sources', 'POST', {
        mode: 'register',
        requestKey: randomUUID(),
        registration: {
          intakeKey,
          kind: 'book_pages',
          existingSourceId: null,
          expectedRevision: null,
          assets: [
            { assetId: upload.assetId, order: 0, printedPageLabel: '十二' },
          ],
          metadata: {
            title: '器物研究',
            contributors: [],
            authorStatus: 'unknown',
            editionStatement: null,
            publisher: null,
            publicationDateAsPrinted: null,
            isbn: null,
            languages: ['zh-Hant'],
            canonicalUrl: null,
            access: 'stored_copy',
            rightsStatement: null,
            attributionText: null,
          },
        },
      });
      expect(registered.status).toBe(202);
      const accepted = sourceAcceptedSchema.parse(await registered.json());
      expect(await raceFixture.runtime.drain()).toMatchObject({
        settled: 0,
        deferred: 1,
        failures: [],
      });
      expect(uploadedOriginals).toEqual([new Uint8Array(bytes)]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.advanceTimersByTime(6000);
      expect(await raceFixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      vi.useRealTimers();
      const callback = JSON.stringify({
        event_id: randomUUID(),
        event_type: 'parse.completed',
        timestamp: Math.floor(Date.now() / 1000),
        data: { job_id: providerJobId },
      });
      expect(
        (
          await raceFixture.runtime.app.request('/webhooks/llama-parse', {
            method: 'POST',
            headers: {
              'LC-Signature': `sha256=${createHmac('sha256', 'synthetic-webhook-signing-secret').update(callback).digest('hex')}`,
            },
            body: callback,
          })
        ).status,
      ).toBe(202);

      const completedTransportCalls = transport.mock.calls.length;
      const locked = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const barrier = raceFixture.runtime.database.db.transaction(
        async (transaction) => {
          await transaction.execute(
            'LOCK TABLE provider_webhook_inbox IN SHARE MODE',
          );
          locked.resolve();
          await release.promise;
        },
      );
      await locked.promise;
      const drains = Promise.all([
        raceFixture.runtime.drain(),
        raceFixture.runtime.drain(),
      ]);
      try {
        await expect
          .poll(
            async () => {
              const rows = await raceFixture.runtime.database.db.execute(
                "SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE '%provider_webhook_inbox%'",
              );

              return rows[0]?.count;
            },
            { timeout: 5000 },
          )
          .toBe(2);
      } finally {
        release.resolve();
        await barrier;
      }
      const reports = await drains;
      expect(
        reports
          .map((report) => report.webhooks)
          .sort((left, right) => left.delivered - right.delivered),
      ).toEqual([
        { inspected: 1, delivered: 0, deferred: 1 },
        { inspected: 1, delivered: 1, deferred: 0 },
      ]);
      expect(uploadedOriginals).toEqual([new Uint8Array(bytes)]);
      expect(transport).toHaveBeenCalledTimes(completedTransportCalls);
      const detail = sourceDetailSchema.parse(
        await (
          await raceFixture.request(`/v1/sources/${accepted.sourceId}`)
        ).json(),
      );
      expect(detail.version).toMatchObject({
        id: accepted.sourceVersionId,
        status: 'partial',
      });
      expect(detail.pages.items).toMatchObject([
        {
          originalAssetId: upload.assetId,
          printedPageLabel: '十二',
          rawText: 'Retained glaze text',
          quality: 'needs_review',
        },
      ]);
      expect(detail.referenceImages).toHaveLength(1);
      expect(
        (await raceFixture.runtime.storage.read(`originals/${upload.assetId}`))
          .bytes,
      ).toEqual(bytes);
      expect(await raceFixture.runtime.drain()).toMatchObject({
        inspected: 0,
        settled: 0,
        webhooks: { inspected: 0, delivered: 0, deferred: 0 },
      });
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
      await raceFixture.close();
    }
  }, 30_000);

  it('should report temporary receipt failure after persistence becomes unavailable', async () => {
    const receiver = createLlamaWebhookReceiver(
      fixture.runtime.database.db,
      secret,
      now,
    );
    await fixture.runtime.close();
    expect((await receiver(signedRequest(JSON.stringify(event)))).status).toBe(
      503,
    );
  });
});

function signedRequest(body: string): Request {
  return new Request('http://localhost/callback', {
    method: 'POST',
    headers: {
      'LC-Signature': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    },
    body,
  });
}
