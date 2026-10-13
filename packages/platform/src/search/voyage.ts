import sharp from 'sharp';

import { VoyageAIClient } from 'voyageai';

import type { SearchImage } from './image.js';
import type { IndexIdentity, OperationResult } from '@antica/application/ports';

/** embeds canonical pixels in one versioned image space */
export interface VoyageImageEmbedding {
  readonly index: IndexIdentity;
  embed(
    image: SearchImage,
    inputType: 'query' | 'document',
  ): Promise<OperationResult<number[]>>;
}

/** configures the registered Voyage space and its bounded network capability */
export interface VoyageImageEmbeddingParams {
  readonly apiKey: string;
  readonly index: IndexIdentity;
  readonly embedMultimodal?: (
    request: Parameters<VoyageAIClient['multimodalEmbed']>[0],
  ) => Promise<Awaited<ReturnType<VoyageAIClient['multimodalEmbed']>>>;
}

/**
 * embeds canonical image pixels without provider-side truncation
 * @param params explicit model manifest and credentials
 * @returns image embedding capability
 */
export function createVoyageImageEmbedding(
  params: VoyageImageEmbeddingParams,
): VoyageImageEmbedding {
  const client = new VoyageAIClient({ apiKey: params.apiKey });
  const embedMultimodal =
    params.embedMultimodal ??
    (async (request: Parameters<VoyageAIClient['multimodalEmbed']>[0]) =>
      client.multimodalEmbed(request, { timeoutInSeconds: 30, maxRetries: 0 }));

  return {
    index: params.index,
    embed: async (image, inputType) => {
      if (
        !['voyage-multimodal-3', 'voyage-multimodal-3.5'].includes(
          params.index.embeddingModelId,
        ) ||
        params.index.dimensions !== 1024 ||
        !params.index.indexVersion
      ) {
        return {
          success: false,
          error: {
            code: 'INDEX_NOT_READY',
            message:
              'This Voyage SDK adapter requires a registered multimodal model and its default 1,024-dimensional index.',
            retryable: false,
          },
        };
      }
      if (!params.apiKey.trim()) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Voyage credentials are not configured.',
            retryable: false,
          },
        };
      }
      const encoded = await encodeImage(image);
      if (!encoded.success) {
        return encoded;
      }
      try {
        const response = await embedMultimodal({
          model: params.index.embeddingModelId,
          inputType,
          truncation: false,
          inputs: [
            {
              content: [
                {
                  type: 'image_base64',
                  imageBase64: `data:image/png;base64,${encoded.data}`,
                },
              ],
            },
          ],
        });
        const vector = response.data?.[0]?.embedding;
        if (
          response.data?.length !== 1 ||
          response.data[0]?.index !== 0 ||
          !vector ||
          vector.length !== params.index.dimensions ||
          !vector.every(Number.isFinite) ||
          !vector.some((value) => value !== 0)
        ) {
          return {
            success: false,
            error: {
              code: 'INDEX_NOT_READY',
              message:
                'Voyage returned an invalid or incompatible image embedding.',
              retryable: false,
            },
          };
        }

        return { success: true, data: vector };
      } catch (cause) {
        return {
          success: false,
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Voyage image embedding is unavailable.',
            retryable: true,
          },
          cause,
        };
      }
    },
  };
}

/**
 * encodes selected canonical pixels without trusting remote image URLs
 * @param image canonical view and normalized region
 * @returns PNG pixels or a typed decode failure
 */
async function encodeImage(
  image: SearchImage,
): Promise<OperationResult<string>> {
  try {
    const metadata = await sharp(image.bytes, {
      limitInputPixels: 40_000_000,
    }).metadata();
    const width = metadata.width;
    const height = metadata.height;
    const region = image.region;
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
      !Object.values(bounds).every(Number.isFinite) ||
      bounds.x < 0 ||
      bounds.y < 0 ||
      bounds.right > 1 ||
      bounds.bottom > 1 ||
      bounds.right <= bounds.x ||
      bounds.bottom <= bounds.y ||
      (region?.kind === 'polygon' && region.points.length < 3)
    ) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'The selected region is outside its canonical image.',
          retryable: false,
        },
      };
    }
    const polygonPoints =
      region?.kind === 'polygon'
        ? region.points
            .map((point) => `${point.x * width},${point.y * height}`)
            .join(' ')
        : '';
    const masked =
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
    const left = Math.floor(bounds.x * width);
    const top = Math.floor(bounds.y * height);
    const bytes = await sharp(masked)
      .extract({
        left,
        top,
        width: Math.ceil(bounds.right * width) - left,
        height: Math.ceil(bounds.bottom * height) - top,
      })
      .flatten({ background: '#ffffff' })
      .png()
      .toBuffer();

    return { success: true, data: bytes.toString('base64') };
  } catch (cause) {
    return {
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'The canonical image could not be decoded.',
        retryable: false,
      },
      cause,
    };
  }
}
