import sharp from 'sharp';

import type { OperationResult } from '@antica/application/ports';

import type { SearchImage } from './image.js';

/**
 * renders normalized rectangle or polygon selection from canonical bytes
 * @param image immutable canonical view and selected region
 * @returns PNG crop or a typed image validation failure
 */
export async function renderCanonicalImage(
  image: SearchImage,
): Promise<OperationResult<Uint8Array>> {
  try {
    const decoded = await sharp(image.bytes, { limitInputPixels: 40_000_000 })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width, height, channels } = decoded.info;
    const region = image.region;
    const points =
      region?.kind === 'polygon'
        ? region.points
        : region
          ? [
              { x: region.x, y: region.y },
              { x: region.x + region.width, y: region.y + region.height },
            ]
          : [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ];
    if (
      (region?.kind === 'polygon' && points.length < 3) ||
      points.some(
        (point) =>
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.y < 0 ||
          point.x > 1 ||
          point.y > 1,
      ) ||
      (region?.kind === 'rect' && (region.width <= 0 || region.height <= 0))
    ) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_INVALID',
          message: 'The evidence region is outside its canonical view.',
          retryable: false,
        },
      };
    }
    if (
      region?.kind === 'polygon' &&
      Math.abs(
        region.points.reduce((area, point, index) => {
          const next = region.points[(index + 1) % region.points.length]!;

          return area + point.x * next.y - next.x * point.y;
        }, 0),
      ) === 0
    ) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_INVALID',
          message: 'The evidence polygon has no area.',
          retryable: false,
        },
      };
    }
    const left = Math.floor(
      Math.min(...points.map((point) => point.x)) * width,
    );
    const top = Math.floor(
      Math.min(...points.map((point) => point.y)) * height,
    );
    const cropWidth =
      Math.ceil(Math.max(...points.map((point) => point.x)) * width) - left;
    const cropHeight =
      Math.ceil(Math.max(...points.map((point) => point.y)) * height) - top;
    if (cropWidth <= 0 || cropHeight <= 0) {
      return {
        success: false,
        error: {
          code: 'EVIDENCE_INVALID',
          message: 'The evidence region contains no pixels.',
          retryable: false,
        },
      };
    }
    const polygonPoints = points
      .map((point) => `${point.x * width},${point.y * height}`)
      .join(' ');
    const canonical = sharp(decoded.data, { raw: { width, height, channels } });
    const masked =
      region?.kind === 'polygon'
        ? await canonical
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
        : await canonical.png().toBuffer();
    const bytes = await sharp(masked)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();

    return { success: true, data: bytes };
  } catch (cause) {
    return {
      success: false,
      error: {
        code: 'EVIDENCE_INVALID',
        message: 'The evidence image cannot be decoded.',
        retryable: false,
      },
      cause,
    };
  }
}
