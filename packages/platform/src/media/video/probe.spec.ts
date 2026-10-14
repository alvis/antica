import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { probeVideo } from './probe.js';

async function probeFixture(data: unknown) {
  const directory = await mkdtemp(join(tmpdir(), 'antica-probe-'));
  const ffprobePath = join(directory, 'ffprobe');
  try {
    await writeFile(
      ffprobePath,
      `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(data)}'\n`,
      { mode: 0o700 },
    );

    return await probeVideo({
      originalPath: join(directory, 'original'),
      ffprobePath,
      timeoutMs: 10_000,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe('fn:probeVideo', () => {
  it.each([
    {
      kind: 'missing video stream',
      payload: { streams: [], frames: [{ pts: 0 }] },
    },
    {
      kind: 'unsafe time base',
      payload: {
        streams: [{ index: 0, time_base: '9007199254740992/1' }],
        frames: [{ pts: 0 }],
      },
    },
    {
      kind: 'unsafe frame PTS',
      payload: {
        streams: [{ index: 0, time_base: '1/1000' }],
        frames: [{ pts: '9007199254740992' }],
      },
    },
  ])('should reject a $kind timeline from the decoder', async ({ payload }) => {
    const result = await probeFixture(payload);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
    });
  });
});
