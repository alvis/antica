import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { MediaDerivative } from '@antica/application/ports';
import type { CanonicalView, Matrix3, Region } from '@antica/domain';
import type { MediaStore, OriginalObject } from '../storage/media-store.js';
import { derivativeKey } from '../storage/media-store.js';

export interface ImagePresentation {
  readonly rotationQuarterTurns: 0 | 1 | 2 | 3;
  readonly crop: Extract<Region, { kind: 'rect' }> | null;
}
export interface ProcessImageParams {
  readonly store: MediaStore;
  readonly original: OriginalObject;
  readonly derivativeId: string;
  readonly thumbnailDerivativeId?: string;
  readonly viewId: string;
  readonly presentation?: ImagePresentation | null;
}

function multiply(left: Matrix3, right: Matrix3): Matrix3 {
  const product = Array.from({ length: 9 }, (_, index) => {
    const row = Math.floor(index / 3);
    const column = index % 3;
    return (
      left[row * 3]! * right[column]! +
      left[row * 3 + 1]! * right[column + 3]! +
      left[row * 3 + 2]! * right[column + 6]!
    );
  });
  return product as unknown as Matrix3;
}

function orientationToOriginal(
  orientation: number,
  width: number,
  height: number,
): Matrix3 {
  switch (orientation) {
    case 2:
      return [-1, 0, width, 0, 1, 0, 0, 0, 1];
    case 3:
      return [-1, 0, width, 0, -1, height, 0, 0, 1];
    case 4:
      return [1, 0, 0, 0, -1, height, 0, 0, 1];
    case 5:
      return [0, 1, 0, 1, 0, 0, 0, 0, 1];
    case 6:
      return [0, 1, 0, -1, 0, height, 0, 0, 1];
    case 7:
      return [0, -1, width, -1, 0, height, 0, 0, 1];
    case 8:
      return [0, -1, width, 1, 0, 0, 0, 0, 1];
    default:
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

function rotationToCrop(turns: number, width: number, height: number): Matrix3 {
  switch (turns) {
    case 1:
      return [0, 1, 0, -1, 0, height, 0, 0, 1];
    case 2:
      return [-1, 0, width, 0, -1, height, 0, 0, 1];
    case 3:
      return [0, -1, width, 1, 0, 0, 0, 0, 1];
    default:
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

/** produces an orientation-normalized private view while preserving the immutable original */
export async function processImage({
  store,
  original,
  derivativeId,
  thumbnailDerivativeId,
  viewId,
  presentation,
}: ProcessImageParams): Promise<{
  readonly derivative: MediaDerivative;
  readonly view: CanonicalView;
  readonly thumbnail?: MediaDerivative;
}> {
  await store.verifyOriginal(original);
  const { bytes } = await store.read(original.key);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error('Image dimensions unavailable');
  }
  const orientedBytes = await sharp(bytes).rotate().toBuffer();
  const oriented = await sharp(orientedBytes).metadata();
  if (!oriented.width || !oriented.height) {
    throw new Error('Oriented image dimensions unavailable');
  }
  const crop = presentation?.crop;
  const left = crop ? Math.floor(crop.x * oriented.width) : 0;
  const top = crop ? Math.floor(crop.y * oriented.height) : 0;
  const cropWidth = crop
    ? Math.min(
        oriented.width - left,
        Math.max(1, Math.ceil(crop.width * oriented.width)),
      )
    : oriented.width;
  const cropHeight = crop
    ? Math.min(
        oriented.height - top,
        Math.max(1, Math.ceil(crop.height * oriented.height)),
      )
    : oriented.height;
  if (cropWidth <= 0 || cropHeight <= 0) {
    throw new Error('Image crop is outside canonical view');
  }
  const turns = presentation?.rotationQuarterTurns ?? 0;
  const output = await sharp(orientedBytes)
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .rotate(turns * 90)
    .jpeg({ quality: 90 })
    .toBuffer({ resolveWithObject: true });
  const toOriented: Matrix3 = [1, 0, left, 0, 1, top, 0, 0, 1];
  const transform = multiply(
    orientationToOriginal(
      metadata.orientation ?? 1,
      metadata.width,
      metadata.height,
    ),
    multiply(toOriented, rotationToCrop(turns, cropWidth, cropHeight)),
  );
  const key = derivativeKey(original.assetId, derivativeId);
  await store.writeDerivative({
    key,
    bytes: output.data,
    mimeType: 'image/jpeg',
  });
  const derivative: MediaDerivative = {
    id: derivativeId,
    originalAssetId: original.assetId,
    parentDerivativeId: null,
    kind: 'canonical',
    storageKey: key,
    mimeType: 'image/jpeg',
    byteLength: output.data.byteLength,
    sha256: createHash('sha256').update(output.data).digest('hex'),
    region: crop ?? null,
    transformToOriginal: transform,
  };
  const view: CanonicalView = {
    id: viewId,
    originalAssetId: original.assetId,
    derivativeId,
    width: output.info.width,
    height: output.info.height,
    originalCoordinateSpace: 'image_pixels',
    transformToOriginal: transform,
  };
  if (!thumbnailDerivativeId) {
    return { derivative, view };
  }
  const thumbnailOutput = await sharp(output.data)
    .resize({
      width: 320,
      height: 320,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 80 })
    .toBuffer({ resolveWithObject: true });
  const thumbnailKey = derivativeKey(original.assetId, thumbnailDerivativeId);
  await store.writeDerivative({
    key: thumbnailKey,
    bytes: thumbnailOutput.data,
    mimeType: 'image/jpeg',
  });
  const thumbnailTransform = multiply(transform, [
    output.info.width / thumbnailOutput.info.width,
    0,
    0,
    0,
    output.info.height / thumbnailOutput.info.height,
    0,
    0,
    0,
    1,
  ]);
  const thumbnail: MediaDerivative = {
    id: thumbnailDerivativeId,
    originalAssetId: original.assetId,
    parentDerivativeId: derivativeId,
    kind: 'thumbnail',
    storageKey: thumbnailKey,
    mimeType: 'image/jpeg',
    byteLength: thumbnailOutput.data.byteLength,
    sha256: createHash('sha256').update(thumbnailOutput.data).digest('hex'),
    region: crop ?? null,
    transformToOriginal: thumbnailTransform,
  };
  return { derivative, view, thumbnail };
}
