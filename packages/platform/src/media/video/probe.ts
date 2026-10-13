import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { z } from 'zod';

import type { OperationResult } from '@antica/application/ports';
import type { FrameLocator } from '@antica/domain';

/** identifies one decoded frame by ordinal and presentation timestamp */
export interface ProbedFrame {
  readonly ordinal: number;
  readonly pts: string;
  readonly displayTimeMs: number;
}

/** preserves the stream clock and decoded frame timeline */
export interface ProbedVideo {
  readonly streamIndex: number;
  readonly timeBase: FrameLocator['timeBase'];
  readonly frames: readonly ProbedFrame[];
}

/** configures the bounded presentation-timeline probe */
export interface ProbeVideoParams {
  readonly originalPath: string;
  readonly ffprobePath: string;
  readonly timeoutMs: number;
}

const executeFile = promisify(execFile);
const PROBE_BUFFER_BYTES = 16_777_216;
const MILLISECONDS_PER_SECOND = 1000;
const probeSchema = z.object({
  streams: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        time_base: z.string().regex(/^[1-9]\d*\/[1-9]\d*$/),
      }),
    )
    .length(1),
  frames: z
    .array(
      z.object({
        pts: z
          .union([z.string().regex(/^-?\d+$/), z.number().int().safe()])
          .transform((pts) => String(pts)),
      }),
    )
    .min(1),
});

/**
 * probes actual decoded timestamps rather than inferring frame rate
 * @param params immutable local original and decoder limits
 * @returns the original presentation timeline or an unsupported-media failure
 */
export async function probeVideo(
  params: ProbeVideoParams,
): Promise<OperationResult<ProbedVideo>> {
  const { originalPath, ffprobePath, timeoutMs } = params;
  const { stdout } = await executeFile(
    ffprobePath,
    [
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
      originalPath,
    ],
    { timeout: timeoutMs, maxBuffer: PROBE_BUFFER_BYTES },
  );
  const probe = probeSchema.safeParse(JSON.parse(stdout));
  if (!probe.success) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'The video lacks a valid presentation timestamp timeline.',
        retryable: false,
      },
    };
  }

  return mapPresentationTimeline(probe.data);
}

/**
 * maps validated decoder output to the original presentation clock
 * @param probe decoded stream and frame timestamps
 * @returns a safe timeline or an unsupported-media failure
 */
function mapPresentationTimeline(
  probe: z.infer<typeof probeSchema>,
): OperationResult<ProbedVideo> {
  const stream = probe.streams[0]!;
  const [numerator, denominator] = stream.time_base.split('/').map(Number);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'The video time base is unsupported.',
        retryable: false,
      },
    };
  }
  const timeBase = { numerator: numerator!, denominator: denominator! };
  const decodedFrames = probe.frames.map((frame, ordinal) => ({
    ordinal,
    pts: frame.pts,
    displayTimeMs:
      (Number(frame.pts) * timeBase.numerator * MILLISECONDS_PER_SECOND) /
      timeBase.denominator,
  }));
  if (
    decodedFrames.some(
      (frame) =>
        !Number.isSafeInteger(Number(frame.pts)) ||
        !Number.isFinite(frame.displayTimeMs),
    )
  ) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'The video presentation timeline is unsupported.',
        retryable: false,
      },
    };
  }

  return {
    success: true,
    data: { streamIndex: stream.index, timeBase, frames: decodedFrames },
  };
}
