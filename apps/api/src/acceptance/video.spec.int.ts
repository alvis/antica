import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import {
  createEvidenceService,
  createMediaJobHandler,
  createMediaService,
  createRecordService,
} from '@antica/application/server';
import { preparedFrameSchema } from '@antica/contracts';

import {
  processImage,
  processVideoFrames,
  createLocalMediaStore,
  createDatabase,
  createTransactionPort,
} from '@antica/platform';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const executeFile = promisify(execFile);

describe('Persistent video frame evidence', () => {
  it('should persist exact frame provenance for a requested video time and replay without another derivative', async () => {
    const database = createDatabase({ url: databaseUrl });
    const directory = await mkdtemp(join(tmpdir(), 'antica-video-job-'));
    const ownerId = randomUUID();
    const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
    const ids = { create: randomUUID };
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    const evidence = createEvidenceService(transaction, clock, ids);
    const store = createLocalMediaStore({
      root: join(directory, 'store'),
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'acceptance-video-job-secret-at-least-32-characters',
    });
    const media = createMediaService(transaction, store, clock, ids);
    const decode = vi.fn(
      async (input: Parameters<typeof processVideoFrames>[0]) =>
        processVideoFrames(input),
    );
    const handler = createMediaJobHandler(
      transaction,
      {
        processImage: async (input) => processImage({ ...input, store }),
        processVideoFrames: async (input) => decode({ ...input, store }),
      },
      clock,
      ids,
    );
    try {
      const path = join(directory, 'original.mp4');
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
        path,
      ]);
      const bytes = await readFile(path);
      const record = await records.create(ownerId, randomUUID(), {
        unitKind: 'single',
      });
      if (!record.success) {
        throw new Error('Record fixture failed');
      }
      const upload = await media.start(ownerId, {
        requestKey: randomUUID(),
        target: { kind: 'record', recordId: record.data.id },
        kind: 'video',
        purpose: 'object',
        componentIds: [],
        fileName: 'walkaround.mp4',
        mimeType: 'video/mp4',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (!upload.success || upload.data.mode !== 'single') {
        throw new Error('Video upload fixture failed');
      }
      await store.acceptUploadToken(
        new URL(upload.data.putUrl).pathname.split('/').at(-1)!,
        bytes,
        'video/mp4',
      );
      expect(
        await media.complete(ownerId, upload.data.assetId, randomUUID()),
      ).toMatchObject({ success: true });
      const pending = await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.outbox.pending(100),
      }));
      if (!pending.data[0]) {
        throw new Error('Upload job missing');
      }
      expect(await handler(ownerId, pending.data[0].event.jobId)).toEqual({
        success: true,
        data: undefined,
      });
      const requested = await evidence.createAnchor(ownerId, {
        requestKey: randomUUID(),
        mode: 'prepare_frame',
        recordId: record.data.id,
        originalAssetId: upload.data.assetId,
        requestedTimeMs: 200,
      });
      if (!requested.success || !('state' in requested.data)) {
        throw new Error('Frame job missing');
      }
      expect(await handler(ownerId, requested.data.id)).toEqual({
        success: true,
        data: undefined,
      });
      expect(await handler(ownerId, requested.data.id)).toEqual({
        success: true,
        data: undefined,
      });
      expect(decode).toHaveBeenCalledTimes(1);
      const job = await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.jobs.get(requested.data.id),
      }));
      expect(job).toMatchObject({
        success: true,
        data: {
          state: { kind: 'succeeded' },
          result: {
            originalAssetId: upload.data.assetId,
            frame: {
              displayTimeMs: 400,
              pts: '4096',
              timeBase: { numerator: 1, denominator: 10240 },
            },
            view: { originalCoordinateSpace: 'video_frame_pixels' },
          },
        },
      });
      expect(await media.get(ownerId, upload.data.assetId)).toMatchObject({
        success: true,
        data: {
          asset: {
            views: [
              expect.objectContaining({ originalAssetId: upload.data.assetId }),
            ],
          },
        },
      });
      expect(await records.get(ownerId, record.data.id)).toMatchObject({
        success: true,
        data: {
          analysisInputVersion: 2,
          evidenceVersion: 2,
          latestRunId: null,
        },
      });
      const prepared = preparedFrameSchema
        .omit({ reads: true })
        .parse(job.data?.result);
      const anchor = {
        kind: 'video_frame' as const,
        recordId: record.data.id,
        componentIds: [],
        originalAssetId: upload.data.assetId,
        canonicalViewId: prepared.view.id,
        scope: { kind: 'whole' as const },
        frame: prepared.frame,
      };
      expect(
        await evidence.createAnchor(ownerId, {
          requestKey: randomUUID(),
          mode: 'create',
          evidence: { ...anchor, frame: { ...anchor.frame, pts: '1' } },
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
      expect(
        await evidence.createAnchor(ownerId, {
          requestKey: randomUUID(),
          mode: 'create',
          evidence: anchor,
        }),
      ).toMatchObject({ success: true, data: { frame: prepared.frame } });
      expect(
        (await store.read(`originals/${upload.data.assetId}`)).bytes,
      ).toEqual(bytes);
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
