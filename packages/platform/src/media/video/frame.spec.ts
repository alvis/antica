import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createLocalMediaStore } from '../../storage/local.js';

import { processSelectedFrames } from './frame.js';

vi.mock('sharp', () => ({
  default: vi.fn(() => ({ metadata: async () => ({}) })),
}));

describe('fn:processSelectedFrames', () => {
  it('should reject a decoded frame without image dimensions', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-frame-'));
    const ffmpegPath = join(directory, 'ffmpeg');
    try {
      await writeFile(
        ffmpegPath,
        '#!/bin/sh\nfor frame_path do :; done\n: > "$frame_path"\n',
        { mode: 0o700 },
      );
      const assetId = randomUUID();
      const result = await processSelectedFrames({
        store: createLocalMediaStore({
          root: directory,
          publicBaseUrl: 'http://localhost:8080',
          signingSecret: 'frame-test-secret-at-least-32-characters',
        }),
        original: {
          assetId,
          key: `originals/${assetId}`,
          mimeType: 'video/mp4',
          byteLength: 1,
          sha256: '0'.repeat(64),
        },
        frames: [
          {
            derivativeId: randomUUID(),
            viewId: randomUUID(),
            displayTimeMs: 0,
          },
        ],
        ffmpegPath,
        directory,
        originalPath: join(directory, 'original'),
        timeoutMs: 10_000,
        video: {
          streamIndex: 0,
          timeBase: { numerator: 1, denominator: 1000 },
          frames: [{ ordinal: 0, pts: '0', displayTimeMs: 0 }],
        },
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
