import type { CanonicalJson } from '@antica/contracts';

/** captures every remote resolution with its exact field location */
export interface ClevelandImage {
  readonly url: string;
  readonly fieldPath: string;
  readonly width?: number;
  readonly height?: number;
}

interface ImageContext {
  readonly fieldPath: string;
  readonly isImage: boolean;
  readonly parent?: CanonicalJson;
}

/**
 * discovers image fields recursively and deduplicates only exact URLs
 * @param data complete captured response
 * @returns stable image locations, including previously unknown image sizes
 */
export function collectImages(data: CanonicalJson): ClevelandImage[] {
  const images = visitImages(data, { fieldPath: '', isImage: false });

  return [...new Map(images.map((image) => [image.url, image])).values()];
}

/**
 * walks source metadata without following or downloading any URL
 * @param value current captured field
 * @param context exact pointer and inherited image-field context
 * @returns all image leaves below this field
 */
function visitImages(
  value: CanonicalJson,
  context: ImageContext,
): ClevelandImage[] {
  if (typeof value === 'string') {
    return /^https?:\/\//.test(value) &&
      (context.isImage ||
        /\.(?:avif|bmp|gif|jpe?g|png|svg|tiff?|webp)(?:[?#]|$)/i.test(value))
      ? [
          {
            url: value,
            fieldPath: context.fieldPath,
            ...imageDimensions(context.parent),
          },
        ]
      : [];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([key, child]) =>
      visitImages(child, {
        fieldPath: `${context.fieldPath}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`,
        isImage:
          context.isImage || /image|thumbnail|poster|rendition/i.test(key),
        parent: value,
      }),
    );
}

/**
 * retains positive integral dimensions when the upstream supplies them
 * @param parent image metadata adjacent to a URL
 * @returns optional pixel dimensions
 */
function imageDimensions(
  parent: CanonicalJson | undefined,
): Pick<ClevelandImage, 'width' | 'height'> {
  const record = parent as Readonly<Record<string, CanonicalJson>>;
  const width = Number(record.width);
  const height = Number(record.height);

  return {
    width: Number.isSafeInteger(width) && width > 0 ? width : undefined,
    height: Number.isSafeInteger(height) && height > 0 ? height : undefined,
  };
}
