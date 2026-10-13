import { describe, expect, it, vi } from 'vitest';

import { createMediaJobHandler } from './media-handler.js';

import type { JobEnvelope, MediaAsset, RecordDetail } from '@antica/contracts';
import type { CanonicalView, FrameLocator } from '@antica/domain';

import type {
  MediaDerivative,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { MediaProcessorPort } from './media-handler.js';

const now = '2026-10-13T12:00:00.000Z';
const recordId = '00000000-0000-4000-8000-000000000001';
const assetId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const derivativeId = '00000000-0000-4000-8000-000000000004';
const viewId = '00000000-0000-4000-8000-000000000005';
const thumbnailId = '00000000-0000-4000-8000-000000000006';
const frameTimeMs = 1250;

const job: JobEnvelope = {
  id: jobId,
  kind: 'media',
  resourceId: assetId,
  state: { kind: 'queued' },
  createdAt: now,
  updatedAt: now,
  result: null,
};
const asset: MediaAsset = {
  id: assetId,
  owner: { kind: 'record', recordId },
  kind: 'photo',
  purpose: 'object',
  state: 'uploaded',
  componentIds: [],
  originalFileName: 'vase.jpg',
  mimeType: 'image/jpeg',
  byteLength: 4,
  sha256: 'a'.repeat(64),
  durationMs: null,
  views: [],
  createdAt: now,
};
const record: RecordDetail = {
  id: recordId,
  code: 'ANT-0001',
  name: 'Vase',
  unitKind: 'single',
  components: [],
  pieceCount: null,
  categoryIds: [],
  materialIds: [],
  period: null,
  dimensions: {},
  location: { locationId: null, detail: '' },
  acquisition: { receiptAssetIds: [] },
  tags: [],
  description: '',
  collectorJudgment: null,
  recordRevision: 1,
  analysisInputVersion: 1,
  evidenceVersion: 1,
  createdAt: now,
  updatedAt: now,
  mediaIds: [assetId],
  checkIds: [],
  latestRunId: null,
  analysisFreshness: 'unanalyzed',
};
const derivative: MediaDerivative = {
  id: derivativeId,
  originalAssetId: assetId,
  parentDerivativeId: null,
  kind: 'canonical',
  storageKey: `derivatives/${derivativeId}`,
  mimeType: 'image/jpeg',
  byteLength: 4,
  sha256: 'b'.repeat(64),
  region: null,
  transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
const view: CanonicalView = {
  id: viewId,
  originalAssetId: assetId,
  derivativeId,
  width: 10,
  height: 10,
  originalCoordinateSpace: 'image_pixels',
  transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
const thumbnail: MediaDerivative = {
  ...derivative,
  id: thumbnailId,
  parentDerivativeId: derivativeId,
  kind: 'thumbnail',
  storageKey: `derivatives/${thumbnailId}`,
};
const frame: FrameLocator = {
  streamIndex: 0,
  timeBase: { numerator: 1, denominator: 1000 },
  pts: '1250',
  frameDerivativeId: derivativeId,
  displayTimeMs: frameTimeMs,
};

function fixture(
  options: {
    readonly job?: JobEnvelope | null;
    readonly asset?: MediaAsset | null;
    readonly record?: RecordDetail | null;
    readonly secondJob?: JobEnvelope | null;
    readonly secondAsset?: MediaAsset | null;
    readonly jobUpdate?: boolean;
    readonly readyUpdate?: boolean;
    readonly versions?: boolean;
    readonly image?: {
      readonly derivative: MediaDerivative;
      readonly view: CanonicalView;
      readonly thumbnail?: MediaDerivative;
    };
    readonly frameResult?: OperationResult<
      ReadonlyArray<{
        readonly derivative: MediaDerivative;
        readonly view: CanonicalView;
        readonly frame: FrameLocator;
      }>
    >;
    readonly videoProcessor?: boolean;
    readonly imageIndex?: OperationResult<void>;
  } = {},
) {
  const current: { job: JobEnvelope | null; asset: MediaAsset | null } = {
    job: 'job' in options ? (options.job ?? null) : job,
    asset: 'asset' in options ? (options.asset ?? null) : asset,
  };
  const writes: { derivatives: MediaDerivative[]; views: CanonicalView[] } = {
    derivatives: [],
    views: [],
  };
  let jobReads = 0;
  let assetReads = 0;
  const updateJob = vi.fn(async (next: JobEnvelope, _expected: string) => {
    if (options.jobUpdate === false) {
      return false;
    }
    current.job = next;

    return true;
  });
  const markReadyOnce = vi.fn(async () => {
    if (options.readyUpdate === false) {
      return false;
    }
    if (current.asset) {
      current.asset = { ...current.asset, state: 'ready' };
    }

    return true;
  });
  const bumpVersions = vi.fn(async () =>
    options.versions === false
      ? null
      : { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 2 },
  );
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      _ownerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      const previous = {
        job: current.job,
        asset: current.asset,
        derivativeCount: writes.derivatives.length,
        viewCount: writes.views.length,
      };
      const repositories = {
        jobs: {
          get: async () => {
            jobReads += 1;

            return jobReads === 2 && 'secondJob' in options
              ? (options.secondJob ?? null)
              : current.job;
          },
          update: updateJob,
        },
        media: {
          get: async () => {
            assetReads += 1;

            return assetReads === 2 && 'secondAsset' in options
              ? (options.secondAsset ?? null)
              : current.asset;
          },
          addDerivative: async (item: MediaDerivative) => {
            writes.derivatives.push(item);
          },
          addCanonicalView: async (item: CanonicalView) => {
            writes.views.push(item);
          },
          markReadyOnce,
        },
        records: {
          get: async () =>
            'record' in options ? (options.record ?? null) : record,
          bumpVersions,
        },
      };
      const result = await operation(
        new Proxy({} as UnitOfWork, {
          get: (_target, key) =>
            key in repositories ? Reflect.get(repositories, key) : undefined,
        }),
      );
      if (!result.success) {
        current.job = previous.job;
        current.asset = previous.asset;
        writes.derivatives.length = previous.derivativeCount;
        writes.views.length = previous.viewCount;
      }

      return result;
    },
  };
  const processImage = vi.fn(async () => options.image ?? { derivative, view });
  const processVideoFrames = vi.fn(
    async () =>
      options.frameResult ?? {
        success: true as const,
        data: [
          {
            derivative: { ...derivative, kind: 'frame' as const, frame },
            view: {
              ...view,
              originalCoordinateSpace: 'video_frame_pixels' as const,
            },
            frame,
          },
        ],
      },
  );
  const indexImage = vi.fn(
    async () =>
      options.imageIndex ?? {
        success: true as const,
        data: undefined,
      },
  );
  const processor: MediaProcessorPort = {
    processImage,
    indexImage,
    ...(options.videoProcessor ? { processVideoFrames } : {}),
  };
  const ids = {
    create: vi
      .fn()
      .mockReturnValueOnce(derivativeId)
      .mockReturnValueOnce(viewId)
      .mockReturnValueOnce(thumbnailId),
  };
  const handle = createMediaJobHandler(
    transaction,
    processor,
    { now: () => now },
    ids,
  );

  return {
    handle,
    current,
    writes,
    updateJob,
    markReadyOnce,
    bumpVersions,
    processImage,
    processVideoFrames,
    indexImage,
    ids,
  };
}

describe('fn:createMediaJobHandler', () => {
  it('should persist an image derivative, index it, and advance record evidence versions', async () => {
    const ports = fixture();

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.writes).toEqual({ derivatives: [derivative], views: [view] });
    expect(ports.current.job).toMatchObject({
      state: { kind: 'succeeded', completedAt: now },
      result: { assetId, canonicalViewId: viewId },
    });
    expect(ports.current.asset?.state).toBe('ready');
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: true,
    });
    expect(ports.indexImage).toHaveBeenCalledWith({
      ownerId: 'collector-1',
      asset,
      derivative,
      view,
    });
    expect(ports.processImage).toHaveBeenCalledWith({
      original: {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/jpeg',
        byteLength: 4,
        sha256: 'a'.repeat(64),
      },
      derivativeId,
      viewId,
      thumbnailDerivativeId: thumbnailId,
    });
  });

  it('should persist a generated thumbnail with its canonical image in one completion', async () => {
    const ports = fixture({ image: { derivative, view, thumbnail } });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.writes).toEqual({
      derivatives: [derivative, thumbnail],
      views: [view],
    });
    expect(ports.current.job?.state.kind).toBe('succeeded');
  });

  it('should process receipt photos without requesting an object thumbnail', async () => {
    const ports = fixture({ asset: { ...asset, purpose: 'receipt' } });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.processImage).toHaveBeenCalledWith({
      original: {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/jpeg',
        byteLength: 4,
        sha256: 'a'.repeat(64),
      },
      derivativeId,
      viewId,
    });
    expect(ports.writes).toEqual({ derivatives: [derivative], views: [view] });
    expect(ports.indexImage).not.toHaveBeenCalled();
    expect(ports.bumpVersions).not.toHaveBeenCalled();
  });

  it('should roll back both derivatives when thumbnail completion loses its job revision', async () => {
    const ports = fixture({
      image: { derivative, view, thumbnail },
      jobUpdate: false,
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
    expect(ports.current.asset?.state).toBe('uploaded');
  });

  it('should reject missing, unverified, and already failed media before processing', async () => {
    for (const [options, code] of [
      [{ job: null }, 'NOT_FOUND'],
      [{ job: { ...job, kind: 'analysis' } }, 'NOT_FOUND'],
      [{ asset: null }, 'NOT_FOUND'],
      [{ asset: { ...asset, state: 'awaiting_upload' } }, 'UPLOAD_INCOMPLETE'],
      [{ asset: { ...asset, state: 'failed' } }, 'JOB_FAILED'],
    ] as const) {
      const ports = fixture(options);
      expect(await ports.handle('collector-1', jobId)).toMatchObject({
        success: false,
        error: { code },
      });
      expect(ports.processImage).not.toHaveBeenCalled();
      expect(ports.updateJob).not.toHaveBeenCalled();
    }
  });

  it('should leave an already completed media job unchanged', async () => {
    const ports = fixture({
      job: { ...job, state: { kind: 'succeeded', completedAt: now } },
    });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.processImage).not.toHaveBeenCalled();
    expect(ports.updateJob).not.toHaveBeenCalled();
  });

  it('should reject an invalid frame request and a frame against non-video media', async () => {
    for (const result of [
      { requestedTimeMs: -1 },
      { requestedTimeMs: Number.NaN },
    ]) {
      const ports = fixture({ job: { ...job, result } });
      expect(await ports.handle('collector-1', jobId)).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED' },
      });
    }
    const photo = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
    });
    expect(await photo.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID' },
    });
  });

  it('should reject frame processing when the video processor is unavailable', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED' },
    });
  });

  it('should persist a validated video frame with its immutable provenance', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      videoProcessor: true,
    });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.processVideoFrames).toHaveBeenCalledWith({
      original: {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'video/mp4',
        byteLength: 4,
        sha256: 'a'.repeat(64),
      },
      frames: [{ derivativeId, viewId, displayTimeMs: frameTimeMs }],
    });
    expect(ports.current.job).toMatchObject({
      state: { kind: 'succeeded' },
      result: {
        originalAssetId: assetId,
        frame,
        view: {
          id: viewId,
          originalCoordinateSpace: 'video_frame_pixels',
        },
      },
    });
    expect(ports.writes.derivatives).toMatchObject([{ kind: 'frame', frame }]);
    expect(ports.writes.views).toMatchObject([{ id: viewId }]);
  });

  it('should pass through a retryable video processor failure without persistence', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      videoProcessor: true,
      frameResult: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Decoder unavailable',
          retryable: true,
        },
      },
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
  });

  it('should reject a frame result tied to a different original before writing it', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      videoProcessor: true,
      frameResult: {
        success: true,
        data: [
          {
            derivative: {
              ...derivative,
              kind: 'frame',
              frame,
              originalAssetId: recordId,
            },
            view: { ...view, originalCoordinateSpace: 'video_frame_pixels' },
            frame,
          },
        ],
      },
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID' },
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
  });

  it('should reject a video frame when its persisted asset changes before completion', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      secondAsset: null,
      videoProcessor: true,
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
  });

  it('should leave a frame job completed concurrently untouched', async () => {
    const completed = {
      ...job,
      state: { kind: 'succeeded' as const, completedAt: now },
    };
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      secondJob: completed,
      videoProcessor: true,
    });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
    expect(ports.updateJob).not.toHaveBeenCalled();
  });

  it('should reject a frame completion that loses its job revision', async () => {
    const ports = fixture({
      job: { ...job, result: { requestedTimeMs: frameTimeMs } },
      asset: { ...asset, kind: 'video', state: 'ready', mimeType: 'video/mp4' },
      videoProcessor: true,
      jobUpdate: false,
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
  });

  it('should stop an image job when indexing fails before recording completion', async () => {
    const ports = fixture({
      imageIndex: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Index unavailable',
          retryable: true,
        },
      },
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(ports.updateJob).not.toHaveBeenCalled();
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
  });

  it('should complete an already ready asset without processing it again', async () => {
    const ports = fixture({ asset: { ...asset, state: 'ready' } });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.processImage).not.toHaveBeenCalled();
    expect(ports.current.job).toMatchObject({ result: { assetId } });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
  });

  it('should leave an image job completed concurrently untouched', async () => {
    const ports = fixture({
      secondJob: { ...job, state: { kind: 'succeeded', completedAt: now } },
    });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.writes).toEqual({ derivatives: [], views: [] });
    expect(ports.updateJob).not.toHaveBeenCalled();
  });

  it('should reject a ready asset completion that loses its job revision', async () => {
    const ports = fixture({
      asset: { ...asset, state: 'ready' },
      jobUpdate: false,
    });

    expect(await ports.handle('collector-1', jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
  });

  it('should finish an uploaded source video without image indexing or record version changes', async () => {
    const ports = fixture({
      asset: {
        ...asset,
        kind: 'video',
        mimeType: 'video/mp4',
        owner: { kind: 'source_intake', intakeKey: recordId },
      },
    });

    expect(await ports.handle('collector-1', jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.processImage).not.toHaveBeenCalled();
    expect(ports.indexImage).not.toHaveBeenCalled();
    expect(ports.bumpVersions).not.toHaveBeenCalled();
    expect(ports.current.job).toMatchObject({
      result: { assetId, canonicalViewId: null },
    });
  });

  it('should report comparison and dependency failures during image completion', async () => {
    for (const [options, code] of [
      [{ secondJob: null }, 'NOT_FOUND'],
      [{ secondAsset: null }, 'NOT_FOUND'],
      [
        { secondAsset: { ...asset, state: 'awaiting_upload' } },
        'REVISION_CONFLICT',
      ],
      [{ readyUpdate: false }, 'REVISION_CONFLICT'],
      [{ record: null }, 'NOT_FOUND'],
      [{ versions: false }, 'REVISION_CONFLICT'],
      [{ jobUpdate: false }, 'REVISION_CONFLICT'],
    ] as const) {
      const ports = fixture(options);
      expect(await ports.handle('collector-1', jobId)).toMatchObject({
        success: false,
        error: { code },
      });
    }
  });
});
