import sharp from 'sharp';

import type { PhotoAngle } from './fixtures/records.js';

/** pixel size of a rendered photo; the design's carousel frame is 390 by 300 */
export interface PhotoFrame {
  readonly widthPx: number;
  readonly heightPx: number;
}

/** region of an intermediate image copied into the output frame */
export interface FrameWindow {
  /** area to extract from the transformed image */
  readonly source: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  /** where the extracted area lands inside the frame */
  readonly offset: { readonly left: number; readonly top: number };
}

/** carousel frame at four times the design's CSS pixels */
export const photoFrame: PhotoFrame = { widthPx: 1560, heightPx: 1200 };

// clockwise CSS rotation per named turn
const quarterTurnDegrees = 90;
const halfTurnDegrees = 180;
const rotationDegrees = {
  none: 0,
  quarter: quarterTurnDegrees,
  half: halfTurnDegrees,
} as const;

// the hero background behind letterboxed rotations
const frameBackground = { r: 21, g: 21, b: 21 };
const jpegQuality = 86;
const receiptFirstLineY = 180;
const receiptLineHeight = 90;

/**
 * renders one angle the way the design's CSS crops the source image
 * @param source bytes of the stand-in source photo
 * @param angle CSS object-position, scale, rotation and mirroring to mirror
 * @param frame output pixel size
 * @returns JPEG bytes of the frame
 */
export async function renderAnglePhoto(
  source: Buffer,
  angle: PhotoAngle,
  frame: PhotoFrame = photoFrame,
): Promise<Buffer> {
  const element = await renderCoveredElement(source, angle, frame);
  const rotated = sharp(element)
    .rotate(rotationDegrees[angle.rotation ?? 'none'])
    .flop(angle.isMirrored ?? false);
  const rotatedSize = await rotated.toBuffer({ resolveWithObject: true });
  const scale = angle.scale ?? 1;
  const scaledWidth = Math.round(rotatedSize.info.width * scale);
  const scaledHeight = Math.round(rotatedSize.info.height * scale);
  const scaled = await sharp(rotatedSize.data)
    .resize(scaledWidth, scaledHeight)
    .toBuffer();
  const window = centeredWindow(
    { widthPx: scaledWidth, heightPx: scaledHeight },
    frame,
  );
  const visible = await sharp(scaled).extract(window.source).toBuffer();

  return sharp({
    create: {
      width: frame.widthPx,
      height: frame.heightPx,
      channels: 3,
      background: frameBackground,
    },
  })
    .composite([
      { input: visible, left: window.offset.left, top: window.offset.top },
    ])
    .jpeg({ quality: jpegQuality })
    .toBuffer();
}

/**
 * renders a plain paper slip standing in for a photographed receipt
 * @param lines receipt text, top to bottom
 * @returns JPEG bytes of the slip
 */
export async function renderReceiptPhoto(
  lines: readonly string[],
): Promise<Buffer> {
  const text = lines
    .map(
      (line, index) =>
        `<text x="80" y="${receiptFirstLineY + index * receiptLineHeight}" font-size="54" fill="#3a3329">${escapeXml(line)}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200"><rect width="900" height="1200" fill="#f3ecdf"/><rect x="40" y="40" width="820" height="1120" fill="none" stroke="#b9ab94" stroke-width="4"/>${text}</svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: jpegQuality }).toBuffer();
}

/**
 * places a transformed element centered in the frame, clipping what overflows
 * @param element size of the scaled and rotated element
 * @param frame output pixel size
 * @returns the visible part of the element and its offset in the frame
 */
export function centeredWindow(
  element: PhotoFrame,
  frame: PhotoFrame,
): FrameWindow {
  const width = Math.min(element.widthPx, frame.widthPx);
  const height = Math.min(element.heightPx, frame.heightPx);

  return {
    source: {
      left: Math.round((element.widthPx - width) / 2),
      top: Math.round((element.heightPx - height) / 2),
      width,
      height,
    },
    offset: {
      left: Math.round((frame.widthPx - width) / 2),
      top: Math.round((frame.heightPx - height) / 2),
    },
  };
}

/**
 * computes the CSS `object-fit: cover` crop of the source for the frame
 * @param source size of the source image
 * @param frame output pixel size
 * @param position object-position fractions of the free space
 * @param position.x horizontal fraction
 * @param position.y vertical fraction
 * @returns resize target and the frame-sized area to extract from it
 */
export function coverCrop(
  source: PhotoFrame,
  frame: PhotoFrame,
  position: { readonly x: number; readonly y: number },
): FrameWindow['source'] & {
  readonly resizedWidth: number;
  readonly resizedHeight: number;
} {
  const factor = Math.max(
    frame.widthPx / source.widthPx,
    frame.heightPx / source.heightPx,
  );
  const resizedWidth = Math.max(
    frame.widthPx,
    Math.round(source.widthPx * factor),
  );
  const resizedHeight = Math.max(
    frame.heightPx,
    Math.round(source.heightPx * factor),
  );

  return {
    resizedWidth,
    resizedHeight,
    left: Math.round((resizedWidth - frame.widthPx) * position.x),
    top: Math.round((resizedHeight - frame.heightPx) * position.y),
    width: frame.widthPx,
    height: frame.heightPx,
  };
}

/**
 * escapes text for an SVG text node
 * @param value raw text
 * @returns XML-safe text
 */
function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * fills the frame with the source as `object-fit: cover` at the angle's object-position
 * @param source bytes of the stand-in source photo
 * @param angle angle whose object-position applies
 * @param frame output pixel size
 * @returns PNG bytes of the frame-sized element before CSS transforms
 */
async function renderCoveredElement(
  source: Buffer,
  angle: PhotoAngle,
  frame: PhotoFrame,
): Promise<Buffer> {
  const { width = 0, height = 0 } = await sharp(source).metadata();
  const crop = coverCrop(
    { widthPx: width, heightPx: height },
    frame,
    angle.position ?? { x: 0.5, y: 0.5 },
  );

  return sharp(source)
    .resize(crop.resizedWidth, crop.resizedHeight)
    .extract({
      left: crop.left,
      top: crop.top,
      width: crop.width,
      height: crop.height,
    })
    .png()
    .toBuffer();
}
