import { describe, expect, it } from 'vitest';

import { rectRegionSchema, regionSchema } from './media.js';

describe('rectangle region validation', () => {
  it('should keep a rectangle within the normalized original image', () => {
    const region = { kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 };

    expect(rectRegionSchema.safeParse(region).success).toBe(true);
    expect(rectRegionSchema.safeParse({ ...region, width: 0.6 }).success).toBe(
      false,
    );
    expect(rectRegionSchema.safeParse({ ...region, height: 0.6 }).success).toBe(
      false,
    );
  });
});

describe('image region validation', () => {
  it('should reject a polygon with no area and accept an actual region', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    expect(regionSchema.safeParse({ kind: 'polygon', points }).success).toBe(
      true,
    );
    expect(
      regionSchema.safeParse({
        kind: 'polygon',
        points: points.map((point) => ({ ...point, y: 0 })),
      }).success,
    ).toBe(false);
    expect(
      regionSchema.safeParse({ kind: 'polygon', points: points.slice(0, 2) })
        .success,
    ).toBe(false);
  });
});
