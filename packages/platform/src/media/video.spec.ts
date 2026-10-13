import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLocalMediaStore } from '../storage/local.js';

import { processVideoFrames } from './video.js';

const executeFile = promisify(execFile);
const probeSchema = z.object({
  streams: z.array(z.object({ index: z.number(), time_base: z.string() })),
  frames: z.array(z.object({ pts: z.number() })),
});

describe('fn:processVideoFrames', () => {
  it('should select actual variable-rate PTS, preserve immutable bytes, and return bounded failures', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-vfr-'));
    try {
      const inputPath = join(root, 'fixture.mp4');
      await executeFile('ffmpeg', [
        '-v',
        'error',
        '-nostdin',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=32x24:rate=10:duration=0.5',
        '-vf',
        'setpts=N*N/(10*TB)',
        '-fps_mode',
        'vfr',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        inputPath,
      ]);
      const { stdout } = await executeFile('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v:0',
        '-show_streams',
        '-show_frames',
        '-show_entries',
        'stream=index,time_base:frame=pts',
        '-of',
        'json',
        inputPath,
      ]);
      const probe = probeSchema.parse(JSON.parse(stdout));
      const stream = probe.streams[0]!;
      const [numerator, denominator] = stream.time_base.split('/').map(Number);
      const timestamps = probe.frames.map(
        (frame) => (frame.pts * numerator! * 1000) / denominator!,
      );
      expect(
        new Set(
          timestamps.slice(1).map((value, index) => value - timestamps[index]!),
        ).size,
      ).toBeGreaterThan(1);
      const target = (timestamps[1]! + timestamps[2]!) / 2;
      const bytes = await readFile(inputPath);
      const assetId = randomUUID();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'video/mp4',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const store = createLocalMediaStore({
        root: join(root, 'store'),
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'acceptance-video-secret-at-least-32-characters',
      });
      const upload = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        bytes,
        original.mimeType,
      );
      const frameRequest = {
        derivativeId: randomUUID(),
        viewId: randomUUID(),
        displayTimeMs: target,
      };

      const result = await processVideoFrames({
        store,
        original,
        frames: [frameRequest],
      });

      expect(result).toMatchObject({
        success: true,
        data: [
          {
            frame: {
              streamIndex: stream.index,
              pts: String(probe.frames[2]!.pts),
              timeBase: { numerator, denominator },
              displayTimeMs: timestamps[2],
              frameDerivativeId: frameRequest.derivativeId,
            },
            view: {
              width: 32,
              height: 24,
              originalCoordinateSpace: 'video_frame_pixels',
              transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            },
          },
        ],
      });
      if (!result.success) {
        throw new Error('Video processing failed');
      }
      const derivative = await store.read(
        result.data[0]!.derivative.storageKey,
      );
      expect(await sharp(derivative.bytes).metadata()).toMatchObject({
        width: 32,
        height: 24,
        format: 'jpeg',
      });
      const expectedPath = join(root, 'expected.jpg');
      await executeFile('ffmpeg', [
        '-v',
        'error',
        '-nostdin',
        '-noautorotate',
        '-i',
        inputPath,
        '-vf',
        'select=eq(n\\,2)',
        '-fps_mode',
        'passthrough',
        '-frames:v',
        '1',
        '-q:v',
        '2',
        expectedPath,
      ]);
      expect(derivative.bytes).toEqual(await readFile(expectedPath));
      expect((await store.read(original.key)).bytes).toEqual(bytes);
      expect(
        await processVideoFrames({
          store,
          original,
          frames: [{ ...frameRequest, displayTimeMs: -1 }],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED', retryable: false },
      });
      expect(
        await processVideoFrames({
          store,
          original,
          frames: [{ ...frameRequest, displayTimeMs: timestamps.at(-1)! + 1 }],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED', retryable: false },
      });
      expect(
        await processVideoFrames({
          store,
          original,
          frames: [frameRequest],
          ffprobePath: join(root, 'missing-ffprobe'),
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
