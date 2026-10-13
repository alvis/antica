import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { mkdtemp, rm, writeFile } from 'node:fs/promises';

import { readLiveRegistry } from './registry.js';

describe('fn:readLiveRegistry', () => {
  it('should validate explicit live registrations without invoking a provider', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const directory = await mkdtemp(join(tmpdir(), 'antica-registry-'));
    try {
      const path = join(directory, 'registry.json');
      await writeFile(
        path,
        JSON.stringify({
          profiles: [
            {
              modelId: 'gateway:test/model',
              provider: 'gateway',
              providerModelVersion: null,
              adapterKind: 'live',
              roles: ['analysis'],
              capabilities: {
                textInput: true,
                imageInput: true,
                audioInput: false,
                structuredOutput: true,
                toolCalling: false,
              },
            },
          ],
        }),
      );
      const registry = await readLiveRegistry(path);
      expect(
        await registry.catalog.resolve(
          {
            modelId: 'unregistered',
            role: 'analysis',
            profileVersion: 'evaluation-v1',
          },
          {},
        ),
      ).toMatchObject({ success: false, error: { code: 'MODEL_UNKNOWN' } });
      await writeFile(path, '{"profiles":[]}');
      await expect(readLiveRegistry(path)).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
