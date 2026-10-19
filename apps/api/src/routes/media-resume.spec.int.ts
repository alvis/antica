import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { afterAll, inject, describe, expect, vi } from 'vitest';

import { createMediaService } from '@antica/application/server';
import {
  mediaCompletionSchema,
  mediaDetailSchema,
  recordDetailSchema,
  uploadResumeSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { collectorUserId } from '@antica/platform';

import { createHttpTest } from '../fixtures/http/test.js';
import { createLocalSettings } from '../fixtures/runtime.js';

import type { AddressInfo } from 'node:net';

import type { RecordDetail } from '@antica/contracts';

import type { HttpFixture } from '../fixtures/http.js';

const resources = inject('httpResources');
/** phone-side transport for signed storage URLs; captured before fixtures stub provider fetch */
const phoneFetch = globalThis.fetch;
const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
const multipartBytes = 64 * 1024 * 1024 + 7;
const partBytes = 16 * 1024 * 1024;
const transferLifetimeMs = 15 * 60_000;

/** in-process S3-compatible multipart provider with paginated part listing */
interface FakeS3 {
  readonly url: string;
  readonly uploads: Map<string, Map<number, Buffer>>;
  readonly objects: Map<string, { bytes: Buffer; contentType: string }>;
  readonly close: () => Promise<void>;
}

/** one parsed provider request */
interface FakeRequest {
  readonly method: string;
  readonly key: string;
  readonly url: URL;
  readonly body: Buffer;
  readonly contentType: string;
}

/** provider reply status, headers, and body */
interface FakeReply {
  readonly status: number;
  readonly headers?: Record<string, string | number>;
  readonly body?: string | Buffer;
}

const listPageSize = 2;
const xmlHeaders = { 'content-type': 'application/xml' };
const noSuchUpload: FakeReply = {
  status: 404,
  headers: xmlHeaders,
  body: '<Error><Code>NoSuchUpload</Code><Message>The specified upload does not exist.</Message></Error>',
};

/**
 * derives a quoted provider ETag for stored part bytes
 * @param bytes stored part contents
 * @returns quoted content digest
 */
function etagOf(bytes: Buffer): string {
  return '"' + createHash('sha256').update(bytes).digest('hex') + '"';
}

/**
 * renders one ListParts page after the requested marker
 * @param request listing request with an optional part-number marker
 * @param parts stored parts of the upload
 * @returns paginated ListPartsResult XML
 */
function listPage(request: FakeRequest, parts: Map<number, Buffer>): FakeReply {
  const marker = Number(
    request.url.searchParams.get('part-number-marker') ?? 0,
  );
  const stored = [...parts.keys()].sort((left, right) => left - right);
  const page = stored
    .filter((number) => number > marker)
    .slice(0, listPageSize);
  const truncated = page.at(-1)! < stored.at(-1)!;
  const next = truncated
    ? '<NextPartNumberMarker>' + String(page.at(-1)) + '</NextPartNumberMarker>'
    : '';
  const entries = page
    .map((number) => {
      const etag = etagOf(parts.get(number)!).replaceAll('"', '&quot;');

      return `<Part><PartNumber>${number}</PartNumber><ETag>${etag}</ETag></Part>`;
    })
    .join('');

  return {
    status: 200,
    headers: xmlHeaders,
    body: `<ListPartsResult><IsTruncated>${truncated}</IsTruncated>${next}${entries}</ListPartsResult>`,
  };
}

/**
 * creates the provider state and request router of a fake S3 bucket
 * @returns observable uploads and objects with their request handler
 */
function createFakeBucket(): Pick<FakeS3, 'uploads' | 'objects'> & {
  readonly handle: (request: FakeRequest) => FakeReply;
} {
  const uploads = new Map<string, Map<number, Buffer>>();
  const types = new Map<string, string>();
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const multipart = (
    request: FakeRequest,
    uploadId: string,
    parts: Map<number, Buffer>,
  ): FakeReply => {
    if (request.method === 'PUT') {
      parts.set(
        Number(request.url.searchParams.get('partNumber')),
        request.body,
      );

      return { status: 200, headers: { etag: etagOf(request.body) } };
    }
    if (request.method === 'GET') {
      return listPage(request, parts);
    }
    if (request.method === 'POST') {
      const order = [
        ...request.body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g),
      ].map((match) => parts.get(Number(match[1]))!);
      objects.set(request.key, {
        bytes: Buffer.concat(order),
        contentType: types.get(uploadId)!,
      });
    }
    uploads.delete(uploadId);

    return {
      status: 200,
      headers: xmlHeaders,
      body: '<CompleteMultipartUploadResult/>',
    };
  };
  const handle = (request: FakeRequest): FakeReply => {
    const uploadId = request.url.searchParams.get('uploadId');
    if (request.method === 'POST' && request.url.searchParams.has('uploads')) {
      const id = randomUUID();
      uploads.set(id, new Map());
      types.set(id, request.contentType);

      return {
        status: 200,
        headers: xmlHeaders,
        body: `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
      };
    }
    if (request.method === 'PUT' && !uploadId) {
      objects.set(request.key, {
        bytes: request.body,
        contentType: request.contentType,
      });

      return { status: 200, headers: { etag: etagOf(request.body) } };
    }
    if (uploadId) {
      const parts = uploads.get(uploadId);

      return parts ? multipart(request, uploadId, parts) : noSuchUpload;
    }
    const object = objects.get(request.key);

    return object
      ? {
          status: 200,
          headers: {
            'content-type': object.contentType,
            'content-length': object.bytes.length,
          },
          body: request.method === 'GET' ? object.bytes : undefined,
        }
      : { status: 404 };
  };

  return { uploads, objects, handle };
}

/**
 * starts a path-style S3 endpoint that lists stored parts two per page
 * @returns endpoint URL, observable provider state, and teardown
 */
async function startFakeS3(): Promise<FakeS3> {
  const bucket = createFakeBucket();
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const url = new URL(request.url ?? '/', 'http://s3.test');
    const reply = bucket.handle({
      method: request.method ?? '',
      key: url.pathname.split('/').slice(2).join('/'),
      url,
      body: Buffer.concat(chunks),
      contentType: request.headers['content-type'] ?? '',
    });
    response.writeHead(reply.status, reply.headers);
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    uploads: bucket.uploads,
    objects: bucket.objects,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const s3 = await startFakeS3();
afterAll(async () => s3.close());
const local = createLocalSettings();
const it = createHttpTest(resources['routes/media-resume']!, {
  ...local,
  app: {
    ...local.app,
    ANTICA_STORAGE_DRIVER: 's3',
    ANTICA_S3_BUCKET: 'private-originals',
    ANTICA_S3_ENDPOINT: s3.url,
    ANTICA_S3_PUBLIC_ENDPOINT: s3.url,
    AWS_ACCESS_KEY_ID: 'test-access',
    AWS_SECRET_ACCESS_KEY: 'test-secret',
  },
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

describe('fn:createMediaRoutes S3 multipart resume', () => {
  it('should resume an interrupted multipart upload into one verified asset whose completion replays idempotently (PT-5)', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const bytes = Buffer.alloc(multipartBytes);
    bytes.set(pngSignature);
    for (let offset = partBytes; offset < bytes.length; offset += partBytes) {
      bytes[offset] = offset / partBytes;
    }
    const request = {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'large.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const started = await fixture.request('/v1/media/uploads', 'POST', request);
    expect(started.status).toBe(201);
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'multipart') {
      throw new Error('Expected a multipart upload');
    }
    expect(upload.parts).toHaveLength(5);
    const put = async (part: {
      putUrl: string;
      offset: number;
      byteLength: number;
    }) => {
      const response = await phoneFetch(part.putUrl, {
        method: 'PUT',
        body: bytes.subarray(part.offset, part.offset + part.byteLength),
      });
      expect(response.status).toBe(200);

      return response.headers.get('etag')!;
    };
    // the app is closed after three parts and loses their ETags
    for (const part of upload.parts.slice(0, 3)) {
      await put(part);
    }
    outliveSignedTransfers();

    const response = await fixture.request(
      `/v1/media/${upload.assetId}/upload`,
    );
    expect(response.status).toBe(200);
    const resumed = uploadResumeSchema.parse(await response.json());
    if (resumed.mode !== 'multipart') {
      throw new Error('Expected the stored multipart mode');
    }
    expect(resumed.uploadId).toBe(upload.uploadId);
    expect(
      resumed.parts.map(({ partNumber, offset, byteLength }) => ({
        partNumber,
        offset,
        byteLength,
      })),
    ).toEqual(
      upload.parts.map(({ partNumber, offset, byteLength }) => ({
        partNumber,
        offset,
        byteLength,
      })),
    );
    expect(resumed.parts.map((part) => part.putUrl)).not.toContain(
      upload.parts[3]!.putUrl,
    );
    expect(Date.parse(resumed.expiresAt)).toBeGreaterThan(
      Date.parse(upload.expiresAt),
    );
    expect(resumed.uploadedParts.map((part) => part.partNumber)).toEqual([
      1, 2, 3,
    ]);
    const remaining: Array<{ partNumber: number; etag: string }> = [];
    for (const part of resumed.parts.slice(3)) {
      remaining.push({ partNumber: part.partNumber, etag: await put(part) });
    }
    const parts = [...resumed.uploadedParts, ...remaining];
    const completion = { requestKey: randomUUID(), parts };
    const completed = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      completion,
    );
    expect(completed.status).toBe(200);
    const result = mediaCompletionSchema.parse(await completed.json());
    expect(result).toMatchObject({
      assetId: upload.assetId,
      state: 'uploaded',
    });
    const replay = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      completion,
    );
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(result);

    const restarted = await fixture.request(
      '/v1/media/uploads',
      'POST',
      request,
    );
    expect(uploadSessionSchema.parse(await restarted.json()).assetId).toBe(
      upload.assetId,
    );
    expect(
      (await (await fixture.request(`/v1/records/${record.id}`)).json()) as {
        mediaIds: string[];
      },
    ).toMatchObject({ mediaIds: [upload.assetId] });
    expect(
      s3.objects.get(`originals/${upload.assetId}`)?.bytes.equals(bytes),
    ).toBe(true);
    expect(s3.uploads.has(upload.uploadId)).toBe(false);
    expect(
      (await fixture.request(`/v1/media/${upload.assetId}/upload`)).status,
    ).toBe(409);
  }, 60_000);

  it('should report a multipart upload the provider no longer holds as expired', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const started = await fixture.request('/v1/media/uploads', 'POST', {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'video',
      purpose: 'object',
      componentIds: [],
      fileName: 'abandoned.mp4',
      mimeType: 'video/mp4',
      byteLength: multipartBytes,
      sha256: 'a'.repeat(64),
    });
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'multipart') {
      throw new Error('Expected a multipart upload');
    }
    s3.uploads.delete(upload.uploadId);

    const response = await fixture.request(
      `/v1/media/${upload.assetId}/upload`,
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      code: 'UPLOAD_EXPIRED',
      retryable: false,
    });
    expect(
      mediaDetailSchema.parse(
        await (await fixture.request(`/v1/media/${upload.assetId}`)).json(),
      ).asset.state,
    ).toBe('awaiting_upload');
  });

  it('should signal an already-stored single upload so completion creates one asset', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const bytes = Buffer.alloc(1024);
    bytes.set(pngSignature);
    const started = await fixture.request('/v1/media/uploads', 'POST', {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'small.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    const upload = uploadSessionSchema.parse(await started.json());
    if (upload.mode !== 'single') {
      throw new Error('Expected a single upload');
    }
    // the PUT lands, then the app is killed before completing
    const landed = await phoneFetch(upload.putUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: bytes,
    });
    expect(landed.status).toBe(200);

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

  it('should signal a multipart upload storage assembled before persistence recorded it, then complete one asset', async ({
    fixture,
  }) => {
    const record = await createRecord(fixture);
    const bytes = Buffer.alloc(multipartBytes);
    bytes.set(pngSignature);
    const request = {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId: record.id },
      kind: 'photo',
      purpose: 'object',
      componentIds: [],
      fileName: 'assembled.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const upload = uploadSessionSchema.parse(
      await (
        await fixture.request('/v1/media/uploads', 'POST', request)
      ).json(),
    );
    if (upload.mode !== 'multipart') {
      throw new Error('Expected a multipart upload');
    }
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (const part of upload.parts) {
      const response = await phoneFetch(part.putUrl, {
        method: 'PUT',
        body: bytes.subarray(part.offset, part.offset + part.byteLength),
      });
      parts.push({
        partNumber: part.partNumber,
        etag: response.headers.get('etag')!,
      });
    }
    // storage assembles the original, then the server dies before its completion transaction
    await fixture.runtime.storage.completeMultipart!(
      {
        assetId: upload.assetId,
        key: `originals/${upload.assetId}`,
        mimeType: request.mimeType,
        byteLength: request.byteLength,
        sha256: request.sha256,
      },
      { uploadId: upload.uploadId, layout: upload.parts },
      parts,
    );
    expect(s3.uploads.has(upload.uploadId)).toBe(false);

    const resumed = await fixture.request(`/v1/media/${upload.assetId}/upload`);
    expect(resumed.status).toBe(409);
    expect(await resumed.json()).toMatchObject({ code: 'UPLOAD_STORED' });
    const completion = { requestKey: randomUUID(), parts };
    const completed = await fixture.request(
      `/v1/media/${upload.assetId}/complete`,
      'POST',
      completion,
    );
    expect(completed.status).toBe(200);
    const result = mediaCompletionSchema.parse(await completed.json());
    expect(result).toMatchObject({
      assetId: upload.assetId,
      state: 'uploaded',
    });
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
  }, 60_000);

  it('should resume and complete an upload started under an older 8 MiB part layout as one asset', async ({
    fixture,
  }) => {
    const { transaction, clock, ids, storage } = fixture.runtime;
    const legacyLayout = Array.from({ length: 9 }, (_, index) => ({
      partNumber: index + 1,
      offset: index * 8 * 1024 * 1024,
      byteLength: index < 8 ? 8 * 1024 * 1024 : 7,
    }));
    // an earlier deployment opened the upload and persisted 8 MiB parts
    const legacy = createMediaService(
      transaction,
      {
        signUpload: async (original) => storage.signUpload(original),
        verifyOriginal: async (original) => storage.verifyOriginal(original),
        signRead: async (key) => storage.signRead(key),
        startMultipart: async (original) => {
          const opened = await storage.startMultipart!(original);
          const signed = await storage.resumeMultipart!(
            original,
            opened.uploadId,
            legacyLayout,
          );
          if (signed.state !== 'active') {
            throw new Error('Legacy upload fixture failed');
          }

          return signed;
        },
      },
      clock,
      ids,
    );
    const record = await createRecord(fixture);
    const bytes = Buffer.alloc(multipartBytes);
    bytes.set(pngSignature);
    const request = {
      requestKey: randomUUID(),
      target: { kind: 'record' as const, recordId: record.id },
      kind: 'photo' as const,
      purpose: 'object' as const,
      componentIds: [],
      fileName: 'legacy.png',
      mimeType: 'image/png',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const started = await legacy.start(collectorUserId, request);
    if (!started.success || started.data.mode !== 'multipart') {
      throw new Error('Legacy start failed');
    }
    const { assetId } = started.data;

    const response = await fixture.request(`/v1/media/${assetId}/upload`);
    expect(response.status).toBe(200);
    const resumed = uploadResumeSchema.parse(await response.json());
    if (resumed.mode !== 'multipart') {
      throw new Error('Expected the stored multipart mode');
    }
    expect(
      resumed.parts.map(({ partNumber, offset, byteLength }) => ({
        partNumber,
        offset,
        byteLength,
      })),
    ).toEqual(legacyLayout);
    const parts: Array<{ partNumber: number; etag: string }> = [];
    for (const part of resumed.parts) {
      const uploaded = await phoneFetch(part.putUrl, {
        method: 'PUT',
        body: bytes.subarray(part.offset, part.offset + part.byteLength),
      });
      expect(uploaded.status).toBe(200);
      parts.push({
        partNumber: part.partNumber,
        etag: uploaded.headers.get('etag')!,
      });
    }
    const completion = { requestKey: randomUUID(), parts };
    const completed = await fixture.request(
      `/v1/media/${assetId}/complete`,
      'POST',
      completion,
    );
    expect(completed.status).toBe(200);
    const result = mediaCompletionSchema.parse(await completed.json());
    expect(result).toMatchObject({ assetId, state: 'uploaded' });
    expect(
      await (
        await fixture.request(
          `/v1/media/${assetId}/complete`,
          'POST',
          completion,
        )
      ).json(),
    ).toEqual(result);
    expect(s3.objects.get(`originals/${assetId}`)?.bytes.equals(bytes)).toBe(
      true,
    );
    expect(
      (await (await fixture.request(`/v1/records/${record.id}`)).json()) as {
        mediaIds: string[];
      },
    ).toMatchObject({ mediaIds: [assetId] });
  }, 60_000);
});
