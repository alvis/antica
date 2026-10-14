import sharp from 'sharp';

import type { SearchImage } from '../image.js';

/** bounds a canonical image selection in normalized coordinates */
interface ImageBounds {
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
}

const DESCRIPTOR_GRID_SIZE = 8;

/**
 * computes a bounded RGB descriptor for the selected original image region
 * @param image authorized image bytes and canonical selection
 * @returns actual normalized image descriptor
 * @throws {RangeError} when the image has no measurable dimensions
 */
export async function describeImage(image: SearchImage): Promise<Uint8Array> {
  const metadata = await sharp(image.bytes).metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new RangeError('The selected image has no measurable dimensions');
  }
  const bounds = getImageBounds(image.region);
  const maskedBytes = await maskImage(image, width, height);
  const left = Math.floor(bounds.x * width);
  const top = Math.floor(bounds.y * height);

  return sharp(maskedBytes)
    .extract({
      left,
      top,
      width: Math.max(1, Math.ceil(bounds.right * width) - left),
      height: Math.max(1, Math.ceil(bounds.bottom * height) - top),
    })
    .flatten({ background: '#ffffff' })
    .resize(DESCRIPTOR_GRID_SIZE, DESCRIPTOR_GRID_SIZE, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer();
}

/**
 * compares two equal-space RGB descriptors
 * @param first query descriptor
 * @param second candidate descriptor
 * @returns mean absolute channel difference
 */
export function imageDistance(first: Uint8Array, second: Uint8Array): number {
  return (
    first.reduce(
      (total, value, position) => total + Math.abs(value - second[position]!),
      0,
    ) / first.length
  );
}

/**
 * resolves and validates the canonical selection bounds
 * @param region selected image region
 * @returns normalized image bounds
 * @throws {RangeError} when the selection is outside its canonical view
 */
function getImageBounds(region: SearchImage['region']): ImageBounds {
  const bounds =
    region?.kind === 'polygon'
      ? {
          x: Math.min(...region.points.map((point) => point.x)),
          y: Math.min(...region.points.map((point) => point.y)),
          right: Math.max(...region.points.map((point) => point.x)),
          bottom: Math.max(...region.points.map((point) => point.y)),
        }
      : region
        ? {
            x: region.x,
            y: region.y,
            right: region.x + region.width,
            bottom: region.y + region.height,
          }
        : { x: 0, y: 0, right: 1, bottom: 1 };
  if (
    bounds.x < 0 ||
    bounds.y < 0 ||
    bounds.right > 1 ||
    bounds.bottom > 1 ||
    bounds.right <= bounds.x ||
    bounds.bottom <= bounds.y
  ) {
    throw new RangeError('The image selection is outside its canonical view');
  }

  return bounds;
}

/**
 * masks a polygon while preserving the original pixels for other selections
 * @param image authorized image bytes and canonical selection
 * @param width original width in pixels
 * @param height original height in pixels
 * @returns pixels prepared for the selected bounds
 */
async function maskImage(
  image: SearchImage,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const region = image.region;
  const polygonPoints =
    region?.kind === 'polygon'
      ? region.points
          .map((point) => [point.x * width, point.y * height].join(','))
          .join(' ')
      : '';
  const maskedBytes =
    region?.kind === 'polygon'
      ? await sharp(image.bytes)
          .ensureAlpha()
          .composite([
            {
              input: Buffer.from(
                `<svg width="${width}" height="${height}"><polygon points="${polygonPoints}" fill="white"/></svg>`,
              ),
              blend: 'dest-in',
            },
          ])
          .png()
          .toBuffer()
      : image.bytes;

  return maskedBytes;
}
