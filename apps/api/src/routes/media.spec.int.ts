import { createHash, randomUUID } from 'node:crypto';

import { inject, describe, expect, vi } from 'vitest';

import {
  createMediaService,
  createRecordService,
} from '@antica/application/server';
import {
  mediaCompletionSchema,
  mediaDetailSchema,
  recordDetailSchema,
  uploadResumeSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { createHttpTest } from '../fixtures/http/test.js';

import type { RecordDetail } from '@antica/contracts';

import type { HttpFixture } from '../fixtures/http.js';

const transferLifetimeMs = 15 * 60_000;
const resources = inject('httpResources');
const it = createHttpTest(resources['routes/media']!);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
  'base64',
);

describe('fn:createMediaRoutes', () => {
  it('should preserve uploaded image bytes and expose canonical media only after draining the durable job', async ({
    fixture,
  }) => {
    const record = recordDetailSchema.parse(
      await (
        await fixture.request(
          '/v1/records',
          'POST',
          { unitKind: 'single' },
          randomUUID(),
        )
      ).json(),
    );
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
      'base64',
    );
    const started = await fixture.request('/v1/media/uploads', 'POST', {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'capture.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(started.status).toBe(201);
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'single') {
      throw new Error('Expected local single upload');
    }
    const uploaded = await fixture.runtime.app.request(upload.putUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: bytes,
    });
    expect(uploaded.status).toBe(204);
    const completed = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      { requestKey: randomUUID() },
    );
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      assetId: upload.assetId,
      state: 'uploaded',
      processingJobId: expect.any(String),
    });
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const response = await fixture.request(`/v1/media/${upload.assetId}`);
    expect(response.status).toBe(200);
    const media = mediaDetailSchema.parse(await response.json());
    expect(media.asset).toMatchObject({
      state: 'ready',
      views: [expect.objectContaining({ originalAssetId: upload.assetId })],
    });
    expect(
      (await fixture.runtime.storage.read(`originals/${upload.assetId}`)).bytes,
    ).toEqual(bytes);
    expect(await fixture.runtime.drain()).toMatchObject({
      inspected: 0,
      settled: 0,
      failures: [],
    });
  });

  it.for(['/v1/media/uploads', '/v1/media/missing/complete'])(
    'should reject invalid upload commands at %s before creating work',
    async (path, { fixture }) => {
      const response = await fixture.request(path, 'POST', {});
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
      expect(await fixture.runtime.drain()).toMatchObject({
        inspected: 0,
        settled: 0,
      });
    },
  );
});

/**
 * creates an owned record to receive uploaded media
 * @param fixture authenticated API runtime
 * @returns persisted record detail
 */
async function createRecord(fixture: HttpFixture): Promise<RecordDetail> {
  return recordDetailSchema.parse(
    await (
      await fixture.request(
        '/v1/records',
        'POST',
        { unitKind: 'single' },
        randomUUID(),
      )
    ).json(),
  );
}

/** moves the wall clock past the signed transfer lifetime, as an app restart would */
function outliveSignedTransfers(): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + transferLifetimeMs + 60_000);
}

describe('fn:createMediaRoutes resume', () => {
  it('should re-sign an expired single upload and complete the same asset exactly once', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const started = await fixture.request('/v1/media/uploads', 'POST', {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'capture.png',
      mimeType: 'image/png',
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'single') {
      throw new Error('Expected local single upload');
    }
    outliveSignedTransfers();
    const stale = await fixture.runtime.app.request(upload.putUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: png,
    });
    expect(stale.status).toBe(403);

    const response = await fixture.request(
      `/v1/media/${upload.assetId}/upload`,
    );
    expect(response.status).toBe(200);
    const resumed = uploadResumeSchema.parse(await response.json());
    if (resumed.mode !== 'single') {
      throw new Error('Expected the stored single mode');
    }
    expect(resumed).toMatchObject({
      assetId: upload.assetId,
      headers: upload.headers,
      uploadedParts: [],
    });
    expect(resumed.putUrl).not.toBe(upload.putUrl);
    expect(Date.parse(resumed.expiresAt)).toBeGreaterThan(
      Date.parse(upload.expiresAt),
    );
    const uploaded = await fixture.runtime.app.request(resumed.putUrl, {
      method: 'PUT',
      headers: resumed.headers,
      body: png,
    });
    expect(uploaded.status).toBe(204);
    const requestKey = randomUUID();
    const completed = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      { requestKey },
    );
    expect(completed.status).toBe(200);
    const completion = await completed.json();
    const replay = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      { requestKey },
    );
    expect(await replay.json()).toEqual(completion);

    const finished = await fixture.request(
      `/v1/media/${upload.assetId}/upload`,
    );
    expect(finished.status).toBe(409);
    expect(await finished.json()).toMatchObject({
      code: 'UPLOAD_ALREADY_COMPLETED',
      retryable: false,
    });
    expect(
      (await (await fixture.request(`/v1/records/${record.id}`)).json()) as {
        mediaIds: string[];
      },
    ).toMatchObject({ mediaIds: [upload.assetId] });
  });

  it('should signal an already-stored single upload so completion creates one asset', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const started = await fixture.request('/v1/media/uploads', 'POST', {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'landed.png',
      mimeType: 'image/png',
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'single') {
      throw new Error('Expected local single upload');
    }
    // the PUT lands, then the app is killed before completing
    const landed = await fixture.runtime.app.request(upload.putUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: png,
    });
    expect(landed.status).toBe(204);

    const resumed = await fixture.request(`/v1/media/${upload.assetId}/upload`);
    expect(resumed.status).toBe(409);
    expect(await resumed.json()).toMatchObject({
      code: 'UPLOAD_STORED',
      message: 'The file is already stored; complete the upload.',
      retryable: false,
    });
    const completion = { requestKey: randomUUID(), parts: [] };
    const completed = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      completion,
    );
    expect(completed.status).toBe(200);
    const result = mediaCompletionSchema.parse(await completed.json());
    expect(
      await (
        await fixture.request(
          `/v1/media/${upload.assetId}/complete`,
          'POST',
          completion,
        )
      ).json(),
    ).toEqual(result);
    expect(
      (await (await fixture.request(`/v1/records/${record.id}`)).json()) as {
        mediaIds: string[];
      },
    ).toMatchObject({ mediaIds: [upload.assetId] });
  });

  it("should hide another owner's pending upload exactly like an unknown asset", async ({
    fixture,
  }) => {
    const { transaction, clock, ids, storage } = fixture.runtime;
    const foreignOwnerId = randomUUID();
    const record = await createRecordService(transaction, clock, ids).create(
      foreignOwnerId,
      randomUUID(),
      { unitKind: 'single' },
    );
    if (!record.success) {
      throw new Error('Foreign record fixture failed');
    }
    const foreign = await createMediaService(
      transaction,
      storage,
      clock,
      ids,
    ).start(foreignOwnerId, {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.data.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'private.png',
      mimeType: 'image/png',
      byteLength: png.length,
      sha256: createHash('sha256').update(png).digest('hex'),
    });
    if (!foreign.success) {
      throw new Error('Foreign upload fixture failed');
    }

    for (const assetId of [foreign.data.assetId, randomUUID()]) {
      const response = await fixture.request(`/v1/media/${assetId}/upload`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        code: 'NOT_FOUND',
        message: 'Media not found',
        retryable: false,
        requestId: expect.any(String),
      });
    }
  });
});
