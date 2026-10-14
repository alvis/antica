import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { inject, describe, expect } from 'vitest';

import {
  jobStatusEnvelopeSchema,
  recordDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { createHttpTest } from './fixtures/http/test.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['video-jobs']!);

describe('Composed video frame jobs', () => {
  it('should retain exact frame provenance after HTTP upload and frame preparation', async ({
    fixture,
  }) => {
    const directory = await mkdtemp(join(tmpdir(), 'antica-api-video-'));
    try {
      const path = join(directory, 'original.mp4');
      await promisify(execFile)('ffmpeg', [
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
        path,
      ]);
      const bytes = await readFile(path);
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
      const upload = uploadSessionSchema.parse(
        await (
          await fixture.request('/v1/media/uploads', 'POST', {
            requestKey: randomUUID(),
            target: { kind: 'record', recordId: record.id },
            kind: 'video',
            purpose: 'object',
            componentIds: [],
            fileName: 'walkaround.mp4',
            mimeType: 'video/mp4',
            byteLength: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          })
        ).json(),
      );
      if (upload.mode !== 'single') {
        throw new Error('Expected single video upload');
      }
      expect(
        (
          await fixture.runtime.app.request(upload.putUrl, {
            method: 'PUT',
            headers: upload.headers,
            body: bytes,
          })
        ).status,
      ).toBe(204);
      expect(
        (
          await fixture.request(
            `/v1/media/${upload.assetId}/complete`,
            'POST',
            { requestKey: randomUUID() },
          )
        ).status,
      ).toBe(200);
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      const response = await fixture.request('/v1/evidence', 'POST', {
        mode: 'prepare_frame',
        requestKey: randomUUID(),
        recordId: record.id,
        originalAssetId: upload.assetId,
        requestedTimeMs: 200,
      });
      expect(response.status).toBe(202);
      const job = jobStatusEnvelopeSchema.parse(await response.json());
      expect(await fixture.runtime.drain()).toMatchObject({
        settled: 1,
        failures: [],
      });
      expect(
        await (await fixture.request(`/v1/jobs/${job.id}`)).json(),
      ).toMatchObject({
        state: { kind: 'succeeded' },
        result: {
          originalAssetId: upload.assetId,
          frame: {
            displayTimeMs: 400,
            pts: '4096',
            timeBase: { numerator: 1, denominator: 10240 },
          },
          view: { originalCoordinateSpace: 'video_frame_pixels' },
        },
      });
      expect(
        (await fixture.runtime.storage.read(`originals/${upload.assetId}`))
          .bytes,
      ).toEqual(bytes);
      expect(await fixture.runtime.drain()).toMatchObject({
        inspected: 0,
        settled: 0,
        failures: [],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
