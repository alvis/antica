import { createHash } from 'node:crypto';

import {
  GetObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { describe, expect, it, vi } from 'vitest';

import { OriginalVerificationError } from '@antica/application/ports';

import { createS3MediaStore } from './s3.js';

import type { HeadObjectCommandOutput } from '@aws-sdk/client-s3';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const original = {
  assetId: '00000000-0000-4000-8000-000000000001',
  key: 'originals/00000000-0000-4000-8000-000000000001',
  byteLength: png.byteLength,
  mimeType: 'image/png',
  sha256: createHash('sha256').update(png).digest('hex'),
};
const metadata = {
  $metadata: {},
  ContentLength: png.byteLength,
  ContentType: original.mimeType,
} satisfies HeadObjectCommandOutput;
const store = createS3MediaStore({
  bucket: 'private-originals',
  region: 'eu-west-2',
  credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
});

describe('mt:verifyOriginal', () => {
  describe.each([HeadObjectCommand, GetObjectCommand])(
    '%s failures',
    (Command) => {
      it.each([
        {
          kind: 'HTTP 404',
          cause: Object.assign(new Error('Not found'), {
            $metadata: { httpStatusCode: 404 },
          }),
        },
        {
          kind: 'NoSuchKey',
          cause: Object.assign(new Error('No key'), { name: 'NoSuchKey' }),
        },
      ])(
        'should classify $kind as absent and retain the provider cause',
        async ({ cause }) => {
          vi.spyOn(S3Client.prototype, 'send').mockImplementation(
            async (command) => {
              if (command instanceof Command) {
                throw cause;
              }

              return metadata;
            },
          );

          await expect(store.verifyOriginal(original)).rejects.toEqual(
            expect.objectContaining({
              constructor: OriginalVerificationError,
              reason: 'absent',
              cause,
            }),
          );
        },
      );

      it.each([
        {
          kind: 'server failure',
          cause: Object.assign(new Error('Unavailable'), {
            $metadata: { httpStatusCode: 503 },
          }),
        },
        { kind: 'network failure', cause: new Error('Connection reset') },
        {
          kind: 'access denied',
          cause: Object.assign(new Error('Denied'), {
            $metadata: { httpStatusCode: 403 },
          }),
        },
      ])(
        'should propagate $kind unchanged instead of classifying it as absent',
        async ({ cause }) => {
          vi.spyOn(S3Client.prototype, 'send').mockImplementation(
            async (command) => {
              if (command instanceof Command) {
                throw cause;
              }

              return metadata;
            },
          );

          await expect(store.verifyOriginal(original)).rejects.toBe(cause);
        },
      );
    },
  );
});
