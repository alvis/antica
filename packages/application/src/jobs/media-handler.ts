import {
  canonicalViewSchema,
  frameLocatorSchema,
  preparedFrameResultSchema,
} from '@antica/contracts';

import type { MediaAsset } from '@antica/contracts';
import type { CanonicalView, FrameLocator } from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  MediaDerivative,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

export interface MediaProcessorPort {
  processImage(input: {
    readonly original: {
      readonly assetId: string;
      readonly key: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly sha256: string;
    };
    readonly derivativeId: string;
    readonly viewId: string;
    readonly thumbnailDerivativeId?: string;
  }): Promise<{
    readonly derivative: MediaDerivative;
    readonly view: CanonicalView;
    readonly thumbnail?: MediaDerivative;
  }>;
  indexImage?(input: {
    readonly ownerId: string;
    readonly asset: MediaAsset;
    readonly derivative: MediaDerivative;
    readonly view: CanonicalView;
  }): Promise<OperationResult<void>>;
  processVideoFrames?(input: {
    readonly original: {
      readonly assetId: string;
      readonly key: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly sha256: string;
    };
    readonly frames: ReadonlyArray<{
      readonly derivativeId: string;
      readonly viewId: string;
      readonly displayTimeMs: number;
    }>;
  }): Promise<
    OperationResult<
      ReadonlyArray<{
        readonly derivative: MediaDerivative;
        readonly view: CanonicalView;
        readonly frame: FrameLocator;
      }>
    >
  >;
}

/**
 * creates a worker that finishes media jobs and advances record versions once
 * @param transaction provides owner-scoped job, media, and record updates
 * @param processor creates image derivatives or prepared video frames and optionally indexes images
 * @param clock timestamps completed jobs
 * @param ids creates derivative and canonical view identifiers
 * @returns handler for an owner and job ID that reports completion or a typed job failure
 */
export function createMediaJobHandler(
  transaction: TransactionPort,
  processor: MediaProcessorPort,
  clock: ClockPort,
  ids: IdPort,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const prepared = await transaction.run<
      OperationResult<{
        readonly asset: MediaAsset;
        readonly done: boolean;
        readonly frameTimeMs: number | null;
      }>
    >(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      if (!job || job.kind !== 'media') {
        return failure('NOT_FOUND', 'Media job not found');
      }
      const asset = await unit.media.get(job.resourceId);
      if (!asset) {
        return failure('NOT_FOUND', 'Media asset not found');
      }
      if (asset.state === 'awaiting_upload') {
        return failure(
          'UPLOAD_INCOMPLETE',
          'Original upload has not completed',
        );
      }
      if (asset.state === 'failed') {
        return failure('JOB_FAILED', 'Media asset has failed processing');
      }
      const frameTimeMs = readFrameTime(job.result);
      if (frameTimeMs === undefined) {
        return failure(
          'VALIDATION_FAILED',
          'Frame job has an invalid requested time',
        );
      }
      if (
        frameTimeMs !== null &&
        (asset.kind !== 'video' || asset.state !== 'ready')
      ) {
        return failure('EVIDENCE_INVALID', 'Frame job requires a ready video');
      }

      return {
        success: true,
        data: { asset, done: job.state.kind === 'succeeded', frameTimeMs },
      };
    });
    if (!prepared.success) {
      return prepared;
    }
    if (prepared.data.done) {
      return { success: true, data: undefined };
    }
    const asset = prepared.data.asset;
    const original = {
      assetId: asset.id,
      key: `originals/${asset.id}`,
      mimeType: asset.mimeType,
      byteLength: asset.byteLength,
      sha256: asset.sha256,
    };
    if (prepared.data.frameTimeMs !== null) {
      if (!processor.processVideoFrames) {
        return failure(
          'MEDIA_UNSUPPORTED',
          'Video frame processing is unavailable',
        );
      }
      const processed = await processor.processVideoFrames({
        original,
        frames: [
          {
            derivativeId: ids.create(),
            viewId: ids.create(),
            displayTimeMs: prepared.data.frameTimeMs,
          },
        ],
      });
      if (!processed.success) {
        return processed;
      }
      const frame = processed.data[0];
      if (
        !frame ||
        !canonicalViewSchema.safeParse(frame.view).success ||
        !frameLocatorSchema.safeParse(frame.frame).success ||
        frame.view.originalAssetId !== asset.id ||
        frame.derivative.originalAssetId !== asset.id ||
        frame.view.derivativeId !== frame.derivative.id ||
        frame.frame.frameDerivativeId !== frame.derivative.id
      ) {
        return failure(
          'EVIDENCE_INVALID',
          'Video frame result has inconsistent provenance',
        );
      }
      const frameResult = preparedFrameResultSchema.parse({
        originalAssetId: asset.id,
        frame: frame.frame,
        view: frame.view,
      });

      return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
        const job = await unit.jobs.get(jobId);
        const current = await unit.media.get(asset.id);
        if (!job || !current || current.state !== 'ready') {
          return failure('REVISION_CONFLICT', 'Video or frame job changed');
        }
        if (job.state.kind === 'succeeded') {
          return { success: true, data: undefined };
        }
        await unit.media.addDerivative({
          ...frame.derivative,
          frame: frame.frame,
        });
        await unit.media.addCanonicalView(frame.view);
        const now = clock.now();
        if (
          !(await unit.jobs.update(
            {
              ...job,
              state: { kind: 'succeeded', completedAt: now },
              updatedAt: now,
              result: frameResult,
            },
            job.updatedAt,
          ))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Frame job changed during completion',
          );
        }

        return { success: true, data: undefined };
      });
    }
    const image =
      asset.state !== 'ready' && asset.mimeType.startsWith('image/')
        ? await processor.processImage({
            original,
            derivativeId: ids.create(),
            viewId: ids.create(),
            ...(asset.owner.kind === 'record' && asset.purpose === 'object'
              ? { thumbnailDerivativeId: ids.create() }
              : {}),
          })
        : null;
    if (
      image &&
      asset.owner.kind === 'record' &&
      asset.purpose === 'object' &&
      processor.indexImage
    ) {
      const indexed = await processor.indexImage({
        ownerId,
        asset,
        derivative: image.derivative,
        view: image.view,
      });
      if (!indexed.success) {
        return indexed;
      }
    }

    return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
      const job = await unit.jobs.get(jobId);
      const current = await unit.media.get(asset.id);
      if (!job || !current) {
        return failure('NOT_FOUND', 'Media job or asset not found');
      }
      if (job.state.kind === 'succeeded') {
        return { success: true, data: undefined };
      }
      if (current.state === 'ready') {
        const now = clock.now();
        if (
          !(await unit.jobs.update(
            {
              ...job,
              state: { kind: 'succeeded', completedAt: now },
              updatedAt: now,
              result: { assetId: current.id },
            },
            job.updatedAt,
          ))
        ) {
          return failure(
            'REVISION_CONFLICT',
            'Media job changed during completion',
          );
        }

        return { success: true, data: undefined };
      }
      if (current.state !== 'uploaded' && current.state !== 'processing') {
        return failure(
          'REVISION_CONFLICT',
          'Media state changed during processing',
        );
      }
      if (image) {
        await unit.media.addDerivative(image.derivative);
        if (image.thumbnail) {
          await unit.media.addDerivative(image.thumbnail);
        }
        await unit.media.addCanonicalView(image.view);
      }
      if (!(await unit.media.markReadyOnce(current.id, current.state))) {
        return failure('REVISION_CONFLICT', 'Media became ready concurrently');
      }
      if (current.owner.kind === 'record' && current.purpose === 'object') {
        const record = await unit.records.get(current.owner.recordId);
        if (!record) {
          return failure('NOT_FOUND', 'Media record not found');
        }
        const versions = await unit.records.bumpVersions(
          record.id,
          record.recordRevision,
          { analysisInput: true, evidence: true },
        );
        if (!versions) {
          return failure(
            'REVISION_CONFLICT',
            'Record changed during media processing',
          );
        }
      }
      const now = clock.now();
      if (
        !(await unit.jobs.update(
          {
            ...job,
            state: { kind: 'succeeded', completedAt: now },
            updatedAt: now,
            result: {
              assetId: current.id,
              canonicalViewId: image?.view.id ?? null,
            },
          },
          job.updatedAt,
        ))
      ) {
        return failure(
          'REVISION_CONFLICT',
          'Media job changed during completion',
        );
      }

      return { success: true, data: undefined };
    });
  };
}

/** @param result */
function readFrameTime(result: unknown): number | null | undefined {
  if (!result || typeof result !== 'object' || !('requestedTimeMs' in result)) {
    return null;
  }

  return typeof result.requestedTimeMs === 'number' &&
    Number.isFinite(result.requestedTimeMs) &&
    result.requestedTimeMs >= 0
    ? result.requestedTimeMs
    : undefined;
}

/**
 * @param code
 * @param message
 */
function failure(
  code:
    | 'NOT_FOUND'
    | 'UPLOAD_INCOMPLETE'
    | 'REVISION_CONFLICT'
    | 'JOB_FAILED'
    | 'EVIDENCE_INVALID'
    | 'MEDIA_UNSUPPORTED'
    | 'VALIDATION_FAILED',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: {
      code,
      message,
      retryable: code === 'UPLOAD_INCOMPLETE' || code === 'REVISION_CONFLICT',
    },
  };
}
