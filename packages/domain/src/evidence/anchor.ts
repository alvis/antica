import type { EntityId, Instant } from '../shared.js';

export interface Point {
  readonly x: number;
  readonly y: number;
}
export type Region =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | { readonly kind: 'polygon'; readonly points: readonly Point[] };
export type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
export interface CanonicalView {
  readonly id: EntityId;
  readonly originalAssetId: EntityId;
  readonly derivativeId: EntityId | null;
  readonly width: number;
  readonly height: number;
  readonly originalCoordinateSpace:
    'image_pixels' | 'video_frame_pixels' | 'pdf_page_points';
  readonly transformToOriginal: Matrix3;
}
export type EvidenceScope =
  | { readonly kind: 'whole' }
  | {
      readonly kind: 'region';
      readonly region: Region;
      readonly cropDerivativeId: EntityId | null;
    };
export interface FrameLocator {
  readonly streamIndex: number;
  readonly timeBase: {
    readonly numerator: number;
    readonly denominator: number;
  };
  readonly pts: string;
  readonly frameDerivativeId: EntityId;
  readonly displayTimeMs: number;
}
export type EvidenceInput = {
  readonly recordId: EntityId;
  readonly componentIds: readonly EntityId[];
  readonly originalAssetId: EntityId;
  readonly canonicalViewId: EntityId;
  readonly scope: EvidenceScope;
} & (
  | { readonly kind: 'image' }
  | { readonly kind: 'video_frame'; readonly frame: FrameLocator }
);
export type EvidenceAnchor = EvidenceInput & {
  readonly id: EntityId;
  readonly createdAt: Instant;
};

const MIN_POLYGON_POINTS = 3;

/**
 * checks whether an evidence region stays within its normalized view and has area
 * @param input Proposed evidence anchor.
 * @returns whether the anchor has valid geometry
 */
export function validateEvidenceAnchor(input: EvidenceInput): boolean {
  if (input.scope.kind === 'whole') {
    return true;
  }
  const region = input.scope.region;
  if (region.kind === 'rect') {
    return (
      region.x >= 0 &&
      region.y >= 0 &&
      region.width > 0 &&
      region.height > 0 &&
      region.x + region.width <= 1 &&
      region.y + region.height <= 1
    );
  }
  if (
    region.points.length < MIN_POLYGON_POINTS ||
    region.points.some(
      (point) => point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1,
    )
  ) {
    return false;
  }
  let doubleArea = 0;
  for (let index = 0; index < region.points.length; index += 1) {
    const current = region.points[index]!;
    const next = region.points[(index + 1) % region.points.length]!;
    doubleArea += current.x * next.y - next.x * current.y;
  }

  return Math.abs(doubleArea) > 0;
}
