import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { regionSchema } from '@antica/contracts';

import { renderCanonicalImage } from './pixels.js';

describe('fn:renderCanonicalImage', () => {
  it('should retain the full canonical pixels when no region is selected', async () => {
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#285078' },
    })
      .png()
      .toBuffer();
    const result = await renderCanonicalImage({
      originalAssetId: 'original',
      canonicalViewId: 'canonical',
      bytes,
      region: null,
    });
    if (!result.success) {
      throw new Error('Expected rendered image');
    }
    expect(await sharp(result.data).raw().toBuffer()).toEqual(
      await sharp(bytes).raw().toBuffer(),
    );
  });
  it('should reject a positive rectangle whose width collapses at floating point resolution', async () => {
    const bytes = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#285078' },
    })
      .png()
      .toBuffer();
    const region = regionSchema.parse({
      kind: 'rect',
      x: 0.5,
      y: 0.25,
      width: Number.EPSILON / 8,
      height: 0.5,
    });
    expect(
      await renderCanonicalImage({
        originalAssetId: 'original',
        canonicalViewId: 'canonical',
        bytes,
        region,
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID', retryable: false },
    });
  });
  it('should crop exact canonical pixels and whiten only the region outside a polygon', async () => {
    const raw = Buffer.from(
      Array.from({ length: 16 }, (_, index) => [index * 10, 40, 70]).flat(),
    );
    const bytes = await sharp(raw, {
      raw: { width: 4, height: 4, channels: 3 },
    })
      .png()
      .toBuffer();
    const base = {
      originalAssetId: 'original',
      canonicalViewId: 'canonical',
      bytes,
    };
    const rectangle = await renderCanonicalImage({
      ...base,
      region: { kind: 'rect', x: 0.5, y: 0.25, width: 0.5, height: 0.5 },
    });
    if (!rectangle.success) {
      throw new Error('Rectangle did not render');
    }
    const decoded = await sharp(rectangle.data)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 2, height: 2, channels: 3 });
    expect(decoded.data).toEqual(
      Buffer.from([60, 40, 70, 70, 40, 70, 100, 40, 70, 110, 40, 70]),
    );
    const polygon = await renderCanonicalImage({
      ...base,
      region: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    });
    if (!polygon.success) {
      throw new Error('Polygon did not render');
    }
    const masked = await sharp(polygon.data)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(masked.info).toMatchObject({ width: 4, height: 4 });
    expect(masked.data.subarray(0, 3)).toEqual(raw.subarray(0, 3));
    expect(masked.data.subarray(45, 48)).toEqual(Buffer.from([255, 255, 255]));
    expect(await sharp(bytes).raw().toBuffer()).toEqual(raw);
  });

  it.each([
    { kind: 'rect' as const, x: 0.8, y: 0, width: 0.4, height: 1 },
    { kind: 'rect' as const, x: 0, y: 0, width: 0, height: 1 },
    {
      kind: 'polygon' as const,
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.5 },
        { x: 1, y: 1 },
      ],
    },
  ])(
    'should reject invalid or degenerate geometry without returning whole-image bytes (%j)',
    async (region) => {
      const bytes = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#285078' },
      })
        .png()
        .toBuffer();
      expect(
        await renderCanonicalImage({
          originalAssetId: 'original',
          canonicalViewId: 'canonical',
          bytes,
          region,
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    },
  );

  it('should reject corrupt canonical bytes without returning an original-image fallback', async () => {
    expect(
      await renderCanonicalImage({
        originalAssetId: 'original',
        canonicalViewId: 'canonical',
        bytes: Buffer.from('not an image'),
        region: null,
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });
});
