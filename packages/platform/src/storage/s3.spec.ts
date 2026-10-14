import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

import { describe, expect, it } from 'vitest';

import { createS3MediaStore } from './s3.js';

describe('fn:createS3MediaStore', () => {
  it('should sign exact multipart ranges, reject incomplete ETags, and verify assembled original hashes', async () => {
    const bytes = Buffer.alloc(16 * 1024 * 1024 + 7);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const requests: Array<{ method: string; url: string; body: string }> = [];
    const server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      requests.push({
        method: request.method ?? '',
        url: request.url ?? '',
        body: Buffer.concat(chunks).toString(),
      });
      if (request.method === 'HEAD') {
        response.writeHead(200, {
          'content-length': bytes.length,
          'content-type': 'image/png',
        });
        response.end();
      } else if (request.method === 'GET') {
        response.writeHead(200, {
          'content-length': bytes.length,
          'content-type': 'image/png',
        });
        response.end(bytes);
      } else if (request.url?.includes('uploads')) {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(
          '<InitiateMultipartUploadResult><UploadId>test-upload</UploadId></InitiateMultipartUploadResult>',
        );
      } else {
        response.writeHead(200, { 'content-type': 'application/xml' });
        response.end(
          '<CompleteMultipartUploadResult><ETag>assembled</ETag></CompleteMultipartUploadResult>',
        );
      }
    });
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Test server did not bind');
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
      const assetId = randomUUID();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        byteLength: bytes.length,
        mimeType: 'image/png',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const session = await store.startMultipart(original);
      expect(session.uploadId).toBe('test-upload');
      expect(
        session.parts.map(({ partNumber, offset, byteLength }) => ({
          partNumber,
          offset,
          byteLength,
        })),
      ).toEqual([
        { partNumber: 1, offset: 0, byteLength: 16 * 1024 * 1024 },
        { partNumber: 2, offset: 16 * 1024 * 1024, byteLength: 7 },
      ]);
      for (const part of session.parts) {
        const signed = new URL(part.putUrl);
        expect(signed.origin).toBe('https://phone-storage.example');
        expect(signed.pathname).toBe(`/private-originals/${original.key}`);
        expect(signed.searchParams.get('partNumber')).toBe(
          String(part.partNumber),
        );
        expect(signed.searchParams.get('uploadId')).toBe('test-upload');
        expect(signed.searchParams.get('X-Amz-Signature')).toMatch(
          /^[a-f0-9]{64}$/,
        );
      }
      const etags = [
        { partNumber: 1, etag: '"one"' },
        { partNumber: 2, etag: '"two"' },
      ];
      for (const invalid of [
        etags.slice(0, 1),
        [...etags].reverse(),
        [{ ...etags[0]!, etag: '' }, etags[1]!],
        [{ ...etags[0]!, etag: 'bad\r\nheader' }, etags[1]!],
      ]) {
        await expect(
          store.completeMultipart(original, session.uploadId, invalid),
        ).rejects.toThrow(Error);
      }
      expect(requests).toHaveLength(1);
      await expect(
        store.completeMultipart(
          { ...original, sha256: '0'.repeat(64) },
          session.uploadId,
          etags,
        ),
      ).rejects.toThrow(Error);
      expect(requests.map((request) => request.method)).toEqual([
        'POST',
        'POST',
        'HEAD',
        'GET',
      ]);
      await expect(
        store.completeMultipart(original, session.uploadId, etags),
      ).resolves.toBeUndefined();
      expect(requests.map((request) => request.method)).toEqual([
        'POST',
        'POST',
        'HEAD',
        'GET',
        'POST',
        'HEAD',
        'GET',
      ]);
      expect(requests[1]?.body).toContain('<PartNumber>1</PartNumber>');
      expect(requests[1]?.body).toContain('<PartNumber>2</PartNumber>');
      expect(requests[1]?.body).toMatch(
        /<ETag>(?:&quot;|")one(?:&quot;|")<\/ETag>/,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  }, 30_000);
});
