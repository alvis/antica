import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';

import { describeImage } from './descriptor.js';

describe('fn:describeImage', () => {
  it.each(['width', 'height'] as const)(
    'should reject decoded metadata with no measurable %s',
    async (dimension) => {
      const bytes = await sharp({
        create: { width: 4, height: 4, channels: 3, background: '#285078' },
      })
        .png()
        .toBuffer();
      const metadata = await sharp(bytes).metadata();
      vi.spyOn(sharp.prototype, 'metadata').mockResolvedValueOnce({
        ...metadata,
        [dimension]: 0,
      });

      await expect(
        describeImage({
          originalAssetId: 'image',
          canonicalViewId: 'canonical',
          bytes,
          region: null,
        }),
      ).rejects.toThrow(RangeError);
    },
  );
});
