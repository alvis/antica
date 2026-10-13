import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createLocalMediaStore } from '../storage/local.js';
import { derivativeKey } from '../storage/media-store.js';

import { processImage } from './image.js';

const sharpFactory = vi.hoisted(() => vi.fn());
vi.mock('sharp', async (importOriginal) => {
  const original = await importOriginal<{ default: typeof import('sharp') }>();

  return { default: Object.assign(sharpFactory, original.default) } satisfies {
    default: typeof import('sharp');
  };
});

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
    'base64',
  ),
);

describe('fn:processImage', () => {
  it.each(['source', 'oriented'] as const)(
    'should reject unavailable %s image dimensions before writing a derivative',
    async (stage) => {
      const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
      const store = createLocalMediaStore({
        root,
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'image-test-secret-at-least-32-characters',
      });
      const assetId = randomUUID();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/png',
        byteLength: png.byteLength,
        sha256: createHash('sha256').update(png).digest('hex'),
      };
      const derivativeId = randomUUID();
      try {
        const upload = await store.signUpload(original);
        await store.acceptUploadToken(
          new URL(upload.url).pathname.split('/').at(-1)!,
          png,
          original.mimeType,
        );
        sharpFactory.mockReturnValueOnce({
          metadata: vi.fn(async () =>
            stage === 'source' ? { height: 1 } : { width: 1, height: 1 },
          ),
        });
        sharpFactory.mockReturnValueOnce({
          rotate: vi.fn(() => ({ toBuffer: vi.fn(async () => png) })),
        });
        sharpFactory.mockReturnValueOnce({
          metadata: vi.fn(async () =>
            stage === 'oriented' ? { height: 1 } : { width: 1, height: 1 },
          ),
        });
        sharpFactory.mockReturnValueOnce({
          extract: vi.fn(() => ({
            rotate: vi.fn(() => ({
              jpeg: vi.fn(() => ({
                toBuffer: vi.fn(async () => ({
                  data: png,
                  info: { width: 1, height: 1 },
                })),
              })),
            })),
          })),
        });

        await expect(
          processImage({
            store,
            original,
            derivativeId,
            viewId: randomUUID(),
          }),
        ).rejects.toThrow();
        await expect(
          store.read(derivativeKey(assetId, derivativeId)),
        ).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
