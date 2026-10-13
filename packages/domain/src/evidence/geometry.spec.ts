import { describe, expect, it } from 'vitest';

import { mapEvidencePoint, mapEvidenceRegion } from './geometry.js';

import type { CanonicalView } from './anchor.js';

const rotatedView: CanonicalView = {
  id: 'upright-view',
  originalAssetId: 'camera-original',
  derivativeId: 'upright-derivative',
  width: 300,
  height: 400,
  originalCoordinateSpace: 'image_pixels',
  transformToOriginal: [0, 1, 0, -1, 0, 300, 0, 0, 1],
};

describe('fn:mapEvidenceRegion', () => {
  it('should locate all crop corners in the untouched original after EXIF rotation', () => {
    const result = mapEvidenceRegion(rotatedView, {
      kind: 'rect',
      x: 0.1,
      y: 0.25,
      width: 0.2,
      height: 0.5,
    });

    expect(result).toEqual([
      { x: 100, y: 270 },
      { x: 100, y: 210 },
      { x: 300, y: 210 },
      { x: 300, y: 270 },
    ]);
  });

  it('should keep polygon vertex order when locating an irregular mark', () => {
    const result = mapEvidenceRegion(rotatedView, {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0.5, y: 1 },
      ],
    });

    expect(result).toEqual([
      { x: 0, y: 300 },
      { x: 0, y: 0 },
      { x: 400, y: 150 },
    ]);
  });
});

describe('fn:mapEvidencePoint', () => {
  it('should preserve the projective denominator when locating a corrected book page', () => {
    const result = mapEvidencePoint(
      {
        ...rotatedView,
        width: 100,
        height: 100,
        originalCoordinateSpace: 'pdf_page_points',
        transformToOriginal: [2, 0, 10, 0, 3, 20, 0.01, 0, 1],
      },
      { x: 0.5, y: 0.5 },
    );

    expect(result.x).toBeCloseTo(110 / 1.5);
    expect(result.y).toBeCloseTo(170 / 1.5);
  });

  it('should reject a transform that places the selection at infinity', () => {
    const view: CanonicalView = {
      ...rotatedView,
      transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 0],
    };

    expect(() => mapEvidencePoint(view, { x: 0.5, y: 0.5 })).toThrow(
      RangeError,
    );
  });
});
