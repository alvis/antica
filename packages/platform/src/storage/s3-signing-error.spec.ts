import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { createS3MediaStore } from './s3.js';

const signUrl = vi.hoisted(() =>
  vi.fn(async () => 'https://phone-storage.example/upload'),
);
vi.mock(
  '@aws-sdk/s3-request-presigner',
  () =>
    ({
      getSignedUrl: signUrl,
    }) satisfies Partial<typeof import('@aws-sdk/s3-request-presigner')>,
);

describe('fn:createS3MediaStore', () => {
  it('should abort an initiated multipart upload when part signing fails', async () => {
    const methods: string[] = [];
    const server = createServer((request, response) => {
      methods.push(request.method ?? '');
      if (request.method === 'POST') {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(
          '<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>',
        );
      } else {
        response.writeHead(204);
        response.end();
      }
    });
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
      const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      const assetId = randomUUID();
      signUrl.mockRejectedValueOnce(new Error('signing unavailable'));

      await expect(
        store.startMultipart({
          assetId,
          key: `originals/${assetId}`,
          byteLength: bytes.byteLength,
          mimeType: 'image/png',
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }),
      ).rejects.toThrow();
      expect(methods).toEqual(['POST', 'DELETE']);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
