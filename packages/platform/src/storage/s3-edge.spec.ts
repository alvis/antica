import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { S3Client } from '@aws-sdk/client-s3';

import { describe, expect, it, vi } from 'vitest';

import { createS3MediaStore } from './s3.js';

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { GetObjectCommandOutput } from '@aws-sdk/client-s3';

import type { S3MediaStore } from './s3.js';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
  'base64',
);
const assetId = randomUUID();
const original = {
  assetId,
  key: `originals/${assetId}`,
  byteLength: png.byteLength,
  mimeType: 'image/png',
  sha256: createHash('sha256').update(png).digest('hex'),
};
const jpeg = Buffer.alloc(png.byteLength);
jpeg.set([0xff, 0xd8, 0xff]);

async function runWithS3Server<T>(
  respond: (
    request: IncomingMessage,
    response: ServerResponse,
  ) => Promise<void> | void,
  run: (store: S3MediaStore) => Promise<T>,
): Promise<T> {
  const server = createServer(respond);
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test S3 endpoint did not bind');
    }
    const store = createS3MediaStore({
      bucket: 'private-originals',
      region: 'eu-west-2',
      endpoint: `http://127.0.0.1:${address.port}`,
      publicEndpoint: 'https://phone-storage.example',
      credentials: {
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
    });

    return await run(store);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe('fn:createS3MediaStore', () => {
  it('should refuse development bucket creation in production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const send = vi.spyOn(S3Client.prototype, 'send');
    const store = createS3MediaStore({
      bucket: 'private-originals',
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
    });

    await expect(store.ensureDevelopmentBucket()).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('should create a missing development bucket after a 404 probe', async () => {
    const methods: string[] = [];
    await runWithS3Server(
      (request, response) => {
        methods.push(request.method ?? '');
        if (request.method === 'HEAD') {
          response.writeHead(404);
        } else {
          response.writeHead(200, { 'content-type': 'application/xml' });
        }
        response.end();
      },
      async (store) => {
        await store.ensureDevelopmentBucket();
      },
    );

    expect(methods).toEqual(['HEAD', 'PUT']);
  });

  it('should surface a forbidden bucket probe without attempting creation', async () => {
    const methods: string[] = [];
    await runWithS3Server(
      (request, response) => {
        methods.push(request.method ?? '');
        response.writeHead(403);
        response.end();
      },
      async (store) => {
        await expect(store.ensureDevelopmentBucket()).rejects.toThrow();
      },
    );

    expect(methods).toEqual(['HEAD']);
  });

  it('should reject a declared original beyond S3 multipart capacity before opening an upload', async () => {
    const store = createS3MediaStore({
      bucket: 'private-originals',
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
    });

    await expect(
      store.startMultipart({
        ...original,
        byteLength: 60 * 1024 ** 4,
      }),
    ).rejects.toThrow(RangeError);
  });

  it('should reject a multipart initiation that has no upload identity', async () => {
    await runWithS3Server(
      (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end('<InitiateMultipartUploadResult/>');
      },
      async (store) => {
        await expect(store.startMultipart(original)).rejects.toThrow();
      },
    );
  });

  it('should reject missing multipart identity, empty parts, and oversized ETags', async () => {
    const store = createS3MediaStore({
      bucket: 'private-originals',
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
    });
    const part = { partNumber: 1, etag: 'etag' };

    await expect(
      store.completeMultipart(original, '', [part]),
    ).rejects.toThrow();
    await expect(
      store.completeMultipart(original, 'upload-id', []),
    ).rejects.toThrow();
    await expect(
      store.completeMultipart(original, 'upload-id', [
        { partNumber: 1, etag: 'e'.repeat(257) },
      ]),
    ).rejects.toThrow();
  });

  it('should cancel an identified multipart upload without contacting storage for an empty ID', async () => {
    const methods: string[] = [];
    await runWithS3Server(
      (request, response) => {
        methods.push(request.method ?? '');
        response.writeHead(204);
        response.end();
      },
      async (store) => {
        await expect(store.abortMultipart(original, '')).rejects.toThrow();
        await store.abortMultipart(original, 'upload-id');
      },
    );

    expect(methods).toEqual(['DELETE']);
  });

  it.each([
    { kind: 'length', length: png.byteLength + 1, mimeType: 'image/png' },
    { kind: 'content type', length: png.byteLength, mimeType: 'image/jpeg' },
  ])(
    'should reject stored original metadata with a mismatched $kind',
    async ({ length, mimeType }) => {
      const methods: string[] = [];
      await runWithS3Server(
        (request, response) => {
          methods.push(request.method ?? '');
          response.writeHead(200, {
            'content-length': length,
            'content-type': mimeType,
          });
          response.end();
        },
        async (store) => {
          await expect(store.verifyOriginal(original)).rejects.toThrow();
        },
      );

      expect(methods).toEqual(['HEAD']);
    },
  );

  it.each([
    { kind: 'short body', bytes: png.subarray(0, -1), sha256: original.sha256 },
    {
      kind: 'wrong signature',
      bytes: jpeg,
      sha256: createHash('sha256').update(jpeg).digest('hex'),
    },
  ])(
    'should reject a stored original with a $kind after metadata passes',
    async ({ bytes, sha256 }) => {
      const methods: string[] = [];
      await runWithS3Server(
        (request, response) => {
          methods.push(request.method ?? '');
          response.writeHead(200, {
            'content-length':
              request.method === 'HEAD' ? png.byteLength : bytes.byteLength,
            'content-type': 'image/png',
          });
          response.end(request.method === 'GET' ? bytes : undefined);
        },
        async (store) => {
          await expect(
            store.verifyOriginal({ ...original, sha256 }),
          ).rejects.toThrow();
        },
      );

      expect(methods).toEqual(['HEAD', 'GET']);
    },
  );

  it('should label an object with no stored content type as binary', async () => {
    await runWithS3Server(
      (_request, response) => {
        response.writeHead(200);
        response.end(png);
      },
      async (store) => {
        expect(await store.read(original.key)).toEqual({
          bytes: Uint8Array.from(png),
          mimeType: 'application/octet-stream',
        });
      },
    );
  });

  it('should reject an SDK object response with no body', async () => {
    const response = { $metadata: {} } satisfies GetObjectCommandOutput;
    vi.spyOn(S3Client.prototype, 'send').mockImplementationOnce(
      async () => response,
    );
    const store = createS3MediaStore({
      bucket: 'private-originals',
      region: 'eu-west-2',
      credentials: {
        accessKeyId: 'test-access',
        secretAccessKey: 'test-secret',
      },
    });

    const error: unknown = await store
      .read(original.key)
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(TypeError);
  });

  it('should sign private transfers, read bytes, and persist immutable derivatives and artifacts', async () => {
    const methods: string[] = [];
    await runWithS3Server(
      async (request, response) => {
        methods.push(request.method ?? '');
        for await (const _chunk of request) {
          // drain the SDK request before replying
        }
        if (request.method === 'GET') {
          response.writeHead(200, { 'content-type': 'image/png' });
          response.end(png);
        } else {
          response.writeHead(200, { 'content-type': 'application/xml' });
          response.end('<PutObjectResult/>');
        }
      },
      async (store) => {
        const upload = await store.signUpload(original);
        const read = await store.signRead(original.key);
        expect({
          uploadOrigin: new URL(upload.url).origin,
          uploadHeaders: upload.headers,
          readOrigin: new URL(read.url).origin,
          readHeaders: read.headers,
        }).toEqual({
          uploadOrigin: 'https://phone-storage.example',
          uploadHeaders: {
            'Content-Type': 'image/png',
            'x-amz-checksum-sha256': Buffer.from(
              original.sha256,
              'hex',
            ).toString('base64'),
            'If-None-Match': '*',
          },
          readOrigin: 'https://phone-storage.example',
          readHeaders: {},
        });
        expect(await store.read(original.key)).toEqual({
          bytes: Uint8Array.from(png),
          mimeType: 'image/png',
        });
        await store.writeDerivative({
          key: `derivatives/${assetId}/${randomUUID()}`,
          bytes: png,
          mimeType: 'image/png',
        });
        await store.writeArtifact({
          key: `artifacts/${assetId}/${randomUUID()}/${randomUUID()}`,
          bytes: png,
          mimeType: 'image/png',
        });
        await expect(
          store.writeArtifact({
            key: `derivatives/${assetId}/${randomUUID()}`,
            bytes: png,
            mimeType: 'image/png',
          }),
        ).rejects.toThrow();
      },
    );
    expect(methods).toEqual(['GET', 'PUT', 'PUT']);
  });
});
