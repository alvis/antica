import type { CanonicalView, Point, Region } from './anchor.js';

/**
 * maps a normalized point in a canonical view into original asset coordinates
 * @param view canonical view and its transform to the original asset
 * @param point normalized point in the canonical view
 * @returns point in original asset coordinates
 * @throws {RangeError} when the view transform has a zero homogeneous denominator
 */
export function mapEvidencePoint(view: CanonicalView, point: Point): Point {
  const [a, b, c, d, e, f, g, h, i] = view.transformToOriginal;
  const x = point.x * view.width;
  const y = point.y * view.height;
  const denominator = g * x + h * y + i;
  if (denominator === 0) {
    throw new RangeError('Evidence transform has no finite image');
  }

  return {
    x: (a * x + b * y + c) / denominator,
    y: (d * x + e * y + f) / denominator,
  };
}

/**
 * maps every vertex of a normalized evidence region into original coordinates
 * @param view canonical view and its transform to the original asset
 * @param region normalized rectangle or polygon
 * @returns region vertices in original asset coordinates
 */
export function mapEvidenceRegion(
  view: CanonicalView,
  region: Region,
): readonly Point[] {
  const points =
    region.kind === 'polygon'
      ? region.points
      : [
          { x: region.x, y: region.y },
          { x: region.x + region.width, y: region.y },
          { x: region.x + region.width, y: region.y + region.height },
          { x: region.x, y: region.y + region.height },
        ];

  return points.map((point) => mapEvidencePoint(view, point));
}
