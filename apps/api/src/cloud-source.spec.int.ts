import { createHash, createHmac, randomUUID } from 'node:crypto';

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  sourceAcceptedSchema,
  sourceDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { readKnowledgeConfiguration } from '@antica/platform';

import { createHttpFixture } from './fixtures/http.js';
import { createLocalSettings } from './fixtures/runtime.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
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
  fixture = await createHttpFixture({
    ...createLocalSettings(),
    knowledge: knowledge.data,
  });
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Configured cloud source parsing', () => {
  it('should submit one original and resume the durable parse into retained source pages', async () => {
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
        await fixture.request('/v1/media/uploads', 'POST', {
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
        await fixture.runtime.app.request(upload.putUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: bytes,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fixture.request(`/v1/media/${upload.assetId}/complete`, 'POST', {
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const registered = await fixture.request('/v1/sources', 'POST', {
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
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 0,
      deferred: 1,
      failures: [],
    });
    expect(uploadedOriginals).toEqual([new Uint8Array(bytes)]);
    const callback = JSON.stringify({
      event_id: randomUUID(),
      event_type: 'parse.completed',
      timestamp: Math.floor(Date.now() / 1000),
      data: { job_id: providerJobId },
    });
    expect(
      (
        await fixture.runtime.app.request('/webhooks/llama-parse', {
          method: 'POST',
          headers: {
            'LC-Signature': `sha256=${createHmac('sha256', 'synthetic-webhook-signing-secret').update(callback).digest('hex')}`,
          },
          body: callback,
        })
      ).status,
    ).toBe(202);

    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(6000);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
      webhooks: { inspected: 1, delivered: 1, deferred: 0 },
    });
    const detail = sourceDetailSchema.parse(
      await (await fixture.request(`/v1/sources/${accepted.sourceId}`)).json(),
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
      (await fixture.runtime.storage.read(`originals/${upload.assetId}`)).bytes,
    ).toEqual(bytes);
    expect(await fixture.runtime.drain()).toMatchObject({
      inspected: 0,
      settled: 0,
    });
  });
});
