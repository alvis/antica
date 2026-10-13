import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { mapEvidencePoint } from '@antica/domain';

import { createLocalMediaStore } from '../storage/local.js';

import { processImage } from './image.js';

describe('fn:processImage', () => {
  it('should persist a scaled thumbnail with its parent, digest, and pixel transform', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
    const store = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'image-test-secret-at-least-32-characters',
    });
    const bytes = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 80, g: 150, b: 100 },
      },
    })
      .jpeg()
      .toBuffer();
    const assetId = randomUUID();
    const derivativeId = randomUUID();
    const thumbnailDerivativeId = randomUUID();
    const original = {
      assetId,
      key: `originals/${assetId}`,
      mimeType: 'image/jpeg',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    try {
      const upload = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        bytes,
        original.mimeType,
      );

      const result = await processImage({
        store,
        original,
        derivativeId,
        thumbnailDerivativeId,
        viewId: randomUUID(),
      });

      expect(result.view).toMatchObject({ width: 640, height: 480 });
      expect(result.thumbnail).toMatchObject({
        id: thumbnailDerivativeId,
        originalAssetId: assetId,
        parentDerivativeId: derivativeId,
        kind: 'thumbnail',
        transformToOriginal: [2, 0, 0, 0, 2, 0, 0, 0, 1],
      });
      const thumbnail = result.thumbnail!;
      const stored = await store.read(thumbnail.storageKey);
      expect(await sharp(stored.bytes).metadata()).toMatchObject({
        width: 320,
        height: 240,
        format: 'jpeg',
      });
      expect(thumbnail.byteLength).toBe(stored.bytes.byteLength);
      expect(thumbnail.sha256).toBe(
        createHash('sha256').update(stored.bytes).digest('hex'),
      );
      expect((await store.read(original.key)).bytes).toEqual(bytes);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reject a crop that starts outside the canonical image', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
    const store = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'image-test-secret-at-least-32-characters',
    });
    const bytes = await sharp({
      create: {
        width: 4,
        height: 6,
        channels: 3,
        background: { r: 80, g: 150, b: 100 },
      },
    })
      .jpeg()
      .toBuffer();
    const assetId = randomUUID();
    const original = {
      assetId,
      key: `originals/${assetId}`,
      mimeType: 'image/jpeg',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    try {
      const upload = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        bytes,
        original.mimeType,
      );

      await expect(
        processImage({
          store,
          original,
          derivativeId: randomUUID(),
          viewId: randomUUID(),
          presentation: {
            crop: { kind: 'rect', x: 2, y: 0, width: 0.5, height: 0.5 },
            rotationQuarterTurns: 0,
          },
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each([
    {
      rotationQuarterTurns: 2,
      width: 2,
      height: 3,
      first: { x: 2, y: 3 },
      last: { x: 0, y: 0 },
    },
    {
      rotationQuarterTurns: 3,
      width: 3,
      height: 2,
      first: { x: 2, y: 0 },
      last: { x: 0, y: 3 },
    },
  ])(
    'should map a $rotationQuarterTurns-quarter-turn crop back to source pixels',
    async ({ rotationQuarterTurns, width, height, first, last }) => {
      const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
      const store = createLocalMediaStore({
        root,
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'image-test-secret-at-least-32-characters',
      });
      const bytes = await sharp({
        create: {
          width: 4,
          height: 6,
          channels: 3,
          background: { r: 80, g: 150, b: 100 },
        },
      })
        .jpeg()
        .toBuffer();
      const assetId = randomUUID();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/jpeg',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      try {
        const upload = await store.signUpload(original);
        await store.acceptUploadToken(
          new URL(upload.url).pathname.split('/').at(-1)!,
          bytes,
          original.mimeType,
        );

        const { view } = await processImage({
          store,
          original,
          derivativeId: randomUUID(),
          viewId: randomUUID(),
          presentation: {
            crop: { kind: 'rect', x: 0, y: 0, width: 0.5, height: 0.5 },
            rotationQuarterTurns: rotationQuarterTurns as 2 | 3,
          },
        });

        expect({
          width: view.width,
          height: view.height,
          points: [
            mapEvidencePoint(view, { x: 0, y: 0 }),
            mapEvidencePoint(view, { x: 1, y: 1 }),
          ],
        }).toEqual({ width, height, points: [first, last] });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([
    {
      orientation: 1,
      width: 4,
      height: 6,
      first: { x: 0, y: 0 },
      last: { x: 4, y: 6 },
    },
    {
      orientation: 2,
      width: 4,
      height: 6,
      first: { x: 4, y: 0 },
      last: { x: 0, y: 6 },
    },
    {
      orientation: 3,
      width: 4,
      height: 6,
      first: { x: 4, y: 6 },
      last: { x: 0, y: 0 },
    },
    {
      orientation: 4,
      width: 4,
      height: 6,
      first: { x: 0, y: 6 },
      last: { x: 4, y: 0 },
    },
    {
      orientation: 5,
      width: 6,
      height: 4,
      first: { x: 0, y: 0 },
      last: { x: 4, y: 6 },
    },
    {
      orientation: 6,
      width: 6,
      height: 4,
      first: { x: 0, y: 6 },
      last: { x: 4, y: 0 },
    },
    {
      orientation: 7,
      width: 6,
      height: 4,
      first: { x: 4, y: 6 },
      last: { x: 0, y: 0 },
    },
    {
      orientation: 8,
      width: 6,
      height: 4,
      first: { x: 4, y: 0 },
      last: { x: 0, y: 6 },
    },
  ])(
    'should map EXIF orientation $orientation into immutable original pixels',
    async ({ orientation, width, height, first, last }) => {
      const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
      const store = createLocalMediaStore({
        root,
        publicBaseUrl: 'http://localhost:8080',
        signingSecret: 'image-test-secret-at-least-32-characters',
      });
      const bytes = await sharp({
        create: {
          width: 4,
          height: 6,
          channels: 3,
          background: { r: 80, g: 150, b: 100 },
        },
      })
        .withMetadata({ orientation })
        .jpeg()
        .toBuffer();
      const assetId = randomUUID();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/jpeg',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      try {
        const upload = await store.signUpload(original);
        await store.acceptUploadToken(
          new URL(upload.url).pathname.split('/').at(-1)!,
          bytes,
          original.mimeType,
        );

        const { view } = await processImage({
          store,
          original,
          derivativeId: randomUUID(),
          viewId: randomUUID(),
        });

        expect({
          width: view.width,
          height: view.height,
          points: [
            mapEvidencePoint(view, { x: 0, y: 0 }),
            mapEvidencePoint(view, { x: 1, y: 1 }),
          ],
        }).toEqual({ width, height, points: [first, last] });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('should map a cropped and manually rotated book page back through EXIF orientation without changing the original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-image-'));
    const store = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'image-test-secret-at-least-32-characters',
    });
    const bytes = await sharp({
      create: {
        width: 4,
        height: 6,
        channels: 3,
        background: { r: 80, g: 150, b: 100 },
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const assetId = randomUUID();
    const original = {
      assetId,
      key: `originals/${assetId}`,
      mimeType: 'image/jpeg',
      byteLength: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    try {
      const upload = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        bytes,
        original.mimeType,
      );

      const result = await processImage({
        store,
        original,
        derivativeId: randomUUID(),
        viewId: randomUUID(),
        presentation: {
          crop: {
            kind: 'rect',
            x: 1 / 6,
            y: 1 / 4,
            width: 1 / 2,
            height: 1 / 2,
          },
          rotationQuarterTurns: 1,
        },
      });

      expect(result.view).toMatchObject({
        width: 2,
        height: 3,
        originalAssetId: assetId,
        originalCoordinateSpace: 'image_pixels',
      });
      expect([
        mapEvidencePoint(result.view, { x: 0, y: 0 }),
        mapEvidencePoint(result.view, { x: 1, y: 1 }),
      ]).toEqual([
        { x: 3, y: 5 },
        { x: 1, y: 2 },
      ]);
      expect((await store.read(original.key)).bytes).toEqual(bytes);
      const derivative = await store.read(result.derivative.storageKey);
      expect(await sharp(derivative.bytes).metadata()).toMatchObject({
        width: 2,
        height: 3,
        format: 'jpeg',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
