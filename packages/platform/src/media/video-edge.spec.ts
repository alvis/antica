import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createLocalMediaStore } from '../storage/local.js';

import { processVideoFrames } from './video.js';

const assetId = randomUUID();
const original = {
  assetId,
  key: `originals/${assetId}`,
  mimeType: 'video/mp4',
  byteLength: 12,
  sha256: '0'.repeat(64),
};
const frame = {
  derivativeId: randomUUID(),
  viewId: randomUUID(),
  displayTimeMs: 0,
};
const store = createLocalMediaStore({
  root: tmpdir(),
  publicBaseUrl: 'http://localhost:8080',
  signingSecret: 'video-test-secret-at-least-32-characters',
});

describe('fn:processVideoFrames', () => {
  it('should return a failed probe timeline after reading the stored original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-video-probe-'));
    try {
      const ffprobePath = join(root, 'ffprobe');
      await writeFile(
        ffprobePath,
        '#!/bin/sh\nprintf \'%s\\n\' \'{"streams":[],"frames":[{"pts":0}]}\'\n',
        { mode: 0o700 },
      );
      const bytes = Buffer.from('000000186674797069736f6d00000000', 'hex');
      const assetId = randomUUID();
      const storedOriginal = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'video/mp4',
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const stored = createLocalMediaStore({
        root,
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'video-test-secret-at-least-32-characters',
      });
      const upload = await stored.signUpload(storedOriginal);
      await stored.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        bytes,
        storedOriginal.mimeType,
      );

      const result = await processVideoFrames({
        store: stored,
        original: storedOriginal,
        frames: [frame],
        ffprobePath,
        timeoutMs: 10_000,
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
      });
      expect(result).not.toHaveProperty('cause');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reject an image original before opening storage or media tools', async () => {
    const verify = vi.spyOn(store, 'verifyOriginal');
    const result = await processVideoFrames({
      store,
      original: { ...original, mimeType: 'image/png' },
      frames: [frame],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
    });
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });

  it.each([
    { kind: 'empty request', frames: [] },
    {
      kind: 'too many requests',
      frames: Array.from({ length: 17 }, () => frame),
    },
    {
      kind: 'nonfinite time',
      frames: [{ ...frame, displayTimeMs: Number.NaN }],
    },
  ])('should reject an $kind before decoding', async ({ frames }) => {
    const result = await processVideoFrames({ store, original, frames });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', field: 'frames', retryable: false },
    });
  });

  it.each([
    {
      kind: 'invalid media',
      failure: new Error('invalid bytes'),
      code: 'MEDIA_UNSUPPORTED',
      retryable: false,
    },
    {
      kind: 'timed-out provider',
      failure: Object.assign(new Error('timeout'), { killed: true }),
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
    },
  ])(
    'should classify an $kind from storage processing',
    async ({ failure, code, retryable }) => {
      const failingStore = createLocalMediaStore({
        root: tmpdir(),
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'video-test-secret-at-least-32-characters',
      });
      vi.spyOn(failingStore, 'verifyOriginal').mockRejectedValueOnce(failure);

      const result = await processVideoFrames({
        store: failingStore,
        original,
        frames: [frame],
      });

      expect(result).toMatchObject({
        success: false,
        error: { code, retryable },
      });
    },
  );
});
