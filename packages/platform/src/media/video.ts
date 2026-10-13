import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { processSelectedFrames } from './video/frame.js';
import { probeVideo } from './video/probe.js';

import type {
  MediaDerivative,
  OperationResult,
} from '@antica/application/ports';
import type { CanonicalView, FrameLocator } from '@antica/domain';

import type { MediaStore, OriginalObject } from '../storage/media-store.js';

/** describes a requested frame and its durable derivative identities */
export interface VideoFrameRequest {
  readonly derivativeId: string;
  readonly viewId: string;
  readonly displayTimeMs: number;
}

/** configures bounded decoding of an immutable original video */
export interface ProcessVideoFramesParams {
  readonly store: MediaStore;
  readonly original: OriginalObject;
  readonly frames: readonly VideoFrameRequest[];
  readonly ffmpegPath?: string;
  readonly ffprobePath?: string;
  readonly timeoutMs?: number;
}

/** links a decoded private image to the original stream presentation clock */
export interface ProcessedVideoFrame {
  readonly derivative: MediaDerivative;
  readonly view: CanonicalView;
  readonly frame: FrameLocator;
}

interface MediaProcessError extends Error {
  readonly code?: string | number;
  readonly killed?: boolean;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FRAME_COUNT = 16;

/**
 * extracts actual decoded frames without assuming a constant frame rate
 * @param params original storage and requested presentation times
 * @returns frame derivatives with exact stream timestamps, or a typed processing failure
 */
export async function processVideoFrames(
  params: ProcessVideoFramesParams,
): Promise<OperationResult<readonly ProcessedVideoFrame[]>> {
  const validation = validateFrameRequests(params);
  if (!validation.success) {
    return validation;
  }
  const {
    store,
    original,
    ffprobePath = 'ffprobe',
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = params;
  try {
    const directory = await mkdtemp(join(tmpdir(), 'antica-video-'));
    try {
      await store.verifyOriginal(original);
      const { bytes } = await store.read(original.key);
      const originalPath = join(directory, 'original');
      await writeFile(originalPath, bytes, { mode: 0o600 });
      const video = await probeVideo({ originalPath, ffprobePath, timeoutMs });
      if (!video.success) {
        return video;
      }

      return await processSelectedFrames({
        ...params,
        directory,
        originalPath,
        video: video.data,
        timeoutMs,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  } catch (error) {
    const exception = error as MediaProcessError;
    const isUnavailable =
      typeof exception.code === 'string' || exception.killed === true;

    return {
      success: false,
      error: {
        code: isUnavailable ? 'PROVIDER_UNAVAILABLE' : 'MEDIA_UNSUPPORTED',
        message: isUnavailable
          ? 'Video processing is unavailable. Check the media tools and retry.'
          : 'The video could not be decoded.',
        retryable: isUnavailable,
      },
      cause: exception,
    };
  }
}

/**
 * validates the public video request before any storage or decoder work
 * @param params original media and requested frame times
 * @returns acceptance or a typed unsupported-media or validation failure
 */
function validateFrameRequests(
  params: ProcessVideoFramesParams,
): OperationResult<void> {
  const { original, frames } = params;
  if (!original.mimeType.startsWith('video/')) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'A video original is required.',
        retryable: false,
      },
    };
  }
  if (
    frames.length < 1 ||
    frames.length > MAX_FRAME_COUNT ||
    frames.some(
      (frame) =>
        !Number.isFinite(frame.displayTimeMs) || frame.displayTimeMs < 0,
    )
  ) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Select one to sixteen nonnegative frame times.',
        retryable: false,
        field: 'frames',
      },
    };
  }

  return { success: true, data: undefined };
}
