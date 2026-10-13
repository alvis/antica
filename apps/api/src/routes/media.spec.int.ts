import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  mediaDetailSchema,
  recordDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { createHttpFixture } from '../fixtures/http.js';

let fixture: Awaited<ReturnType<typeof createHttpFixture>>;
beforeAll(async () => {
  fixture = await createHttpFixture();
}, 30_000);
afterAll(async () => {
  await fixture.close();
});

describe('fn:createMediaRoutes', () => {
  it('should preserve uploaded image bytes and expose canonical media only after draining the durable job', async () => {
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

  it.each(['/v1/media/uploads', '/v1/media/missing/complete'])(
    'should reject invalid upload commands at %s before creating work',
    async (path) => {
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
