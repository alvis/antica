import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import sharp from 'sharp';

import { derivativeKey } from '../../storage/media-store.js';

import type { OperationResult } from '@antica/application/ports';
import type { CanonicalView } from '@antica/domain';

import type {
  ProcessedVideoFrame,
  ProcessVideoFramesParams,
  VideoFrameRequest,
} from '../video.js';

import type { ProbedFrame, ProbedVideo } from './probe.js';

/** binds selected requests to a private decoder workspace and probed timeline */
export interface ProcessSelectedFramesParams extends ProcessVideoFramesParams {
  readonly directory: string;
  readonly originalPath: string;
  readonly video: ProbedVideo;
  readonly timeoutMs: number;
}

interface PersistFrameParams extends ProcessSelectedFramesParams {
  readonly request: VideoFrameRequest;
  readonly frame: ProbedFrame;
}

interface DecodedFrame {
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
}

const executeFile = promisify(execFile);
const FRAME_BUFFER_BYTES = 4_194_304;

/**
 * selects the first decoded frame at or after each requested display time
 * @param params requested frames and the actual decoded timeline
 * @returns durable frame derivatives or an out-of-range failure
 */
export async function processSelectedFrames(
  params: ProcessSelectedFramesParams,
): Promise<OperationResult<readonly ProcessedVideoFrame[]>> {
  const selections = params.frames.map((request) => ({
    request,
    frame: params.video.frames.find(
      (frame) => frame.displayTimeMs >= request.displayTimeMs,
    ),
  }));
  if (selections.some((selection) => !selection.frame)) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'A selected time is beyond the last decoded frame.',
        retryable: false,
        field: 'frames',
      },
    };
  }
  const processedFrames: ProcessedVideoFrame[] = [];
  for (const selection of selections) {
    const result = await persistFrame({
      ...params,
      request: selection.request,
      frame: selection.frame!,
    });
    if (!result.success) {
      return result;
    }
    processedFrames.push(result.data);
  }

  return { success: true, data: processedFrames };
}

/**
 * decodes and writes a private derivative with its original-frame locator
 * @param params selected frame, immutable original and storage identities
 * @returns the persisted derivative, canonical view and original timestamp
 */
async function persistFrame(
  params: PersistFrameParams,
): Promise<OperationResult<ProcessedVideoFrame>> {
  const { store, original, request, frame, video } = params;
  const result = await decodeFrame(params);
  if (!result.success) {
    return result;
  }
  const decoded = result.data;
  const storageKey = derivativeKey(original.assetId, request.derivativeId);
  await store.writeDerivative({
    key: storageKey,
    bytes: decoded.bytes,
    mimeType: 'image/jpeg',
  });
  const view: CanonicalView = {
    id: request.viewId,
    originalAssetId: original.assetId,
    derivativeId: request.derivativeId,
    width: decoded.width,
    height: decoded.height,
    originalCoordinateSpace: 'video_frame_pixels',
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  };

  return {
    success: true,
    data: {
      derivative: {
        id: request.derivativeId,
        originalAssetId: original.assetId,
        parentDerivativeId: null,
        kind: 'frame',
        storageKey,
        mimeType: 'image/jpeg',
        byteLength: decoded.bytes.byteLength,
        sha256: createHash('sha256').update(decoded.bytes).digest('hex'),
        region: null,
        transformToOriginal: view.transformToOriginal,
      },
      view,
      frame: {
        streamIndex: video.streamIndex,
        timeBase: video.timeBase,
        pts: frame.pts,
        frameDerivativeId: request.derivativeId,
        displayTimeMs: frame.displayTimeMs,
      },
    },
  };
}

/**
 * decodes by ordinal without changing original frame orientation or pixels
 * @param params selected decoded frame and bounded media process configuration
 * @returns actual JPEG bytes and dimensions or an unsupported-media failure
 */
async function decodeFrame(
  params: PersistFrameParams,
): Promise<OperationResult<DecodedFrame>> {
  const {
    ffmpegPath = 'ffmpeg',
    directory,
    originalPath,
    frame,
    video,
    timeoutMs,
  } = params;
  const framePath = join(directory, `${frame.ordinal}.jpg`);
  await executeFile(
    ffmpegPath,
    [
      '-v',
      'error',
      '-nostdin',
      '-y',
      '-noautorotate',
      '-i',
      originalPath,
      '-map',
      `0:${video.streamIndex}`,
      '-vf',
      `select=eq(n\\,${frame.ordinal})`,
      '-fps_mode',
      'passthrough',
      '-frames:v',
      '1',
      '-q:v',
      '2',
      framePath,
    ],
    { timeout: timeoutMs, maxBuffer: FRAME_BUFFER_BYTES },
  );
  const frameBytes = await readFile(framePath);
  const { width, height } = await sharp(frameBytes).metadata();
  if (!width || !height) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'Decoded frame dimensions are unavailable.',
        retryable: false,
      },
    };
  }

  return { success: true, data: { bytes: frameBytes, width, height } };
}
