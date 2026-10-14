import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { VoyageAIClient } from 'voyageai';

import { createVoyageImageEmbedding } from './voyage.js';

import type { SearchImage } from './image.js';
import type { VoyageImageEmbeddingParams } from './voyage.js';

const index = {
  embeddingModelId: 'voyage-multimodal-3.5',
  dimensions: 1024,
  indexVersion: 'catalog-v1',
};
const vector = Array<number>(1024).fill(0.25);
const redImage: SearchImage = {
  originalAssetId: 'original',
  canonicalViewId: 'view',
  bytes: await sharp({
    create: { width: 20, height: 20, channels: 3, background: '#ff0000' },
  })
    .png()
    .toBuffer(),
  region: null,
};

const sdk = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify({ data: [{ index: 0, embedding: vector }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  ),
}));

vi.mock('voyageai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('voyageai')>();
  class FixtureVoyageAIClient extends actual.VoyageAIClient {
    constructor(
      options?: ConstructorParameters<typeof actual.VoyageAIClient>[0],
    ) {
      super({ ...options, fetch: sdk.fetch });
    }
  }

  return {
    ...actual,
    VoyageAIClient: FixtureVoyageAIClient,
  } satisfies typeof import('voyageai');
});

describe('Voyage image embedding boundary', () => {
  it('should use the SDK boundary with bounded retries when no transport is injected', async () => {
    const multimodalEmbed = vi.spyOn(
      VoyageAIClient.prototype,
      'multimodalEmbed',
    );
    expect(
      await createVoyageImageEmbedding({ apiKey: 'test-only', index }).embed(
        redImage,
        'query',
      ),
    ).toEqual({ success: true, data: vector });
    expect(multimodalEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: 'query' }),
      { timeoutInSeconds: 30, maxRetries: 0 },
    );
  });

  it('should reject missing credentials without invoking the image transport', async () => {
    const embed =
      vi.fn<NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>>();
    expect(
      await createVoyageImageEmbedding({
        apiKey: ' ',
        index,
        embedMultimodal: embed,
      }).embed(redImage, 'query'),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should reject a crop outside canonical pixels before transport', async () => {
    const embed =
      vi.fn<NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>>();
    expect(
      await createVoyageImageEmbedding({
        apiKey: 'test-only',
        index,
        embedMultimodal: embed,
      }).embed(
        {
          ...redImage,
          region: { kind: 'rect', x: 0.9, y: 0, width: 0.2, height: 1 },
        },
        'query',
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should send the selected canonical pixels and preserve the query embedding role', async () => {
    const observed: {
      request?: Parameters<
        NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>
      >[0];
    } = {};
    const embed = vi.fn<
      NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>
    >(async (request) => {
      observed.request ??= request;

      return { data: [{ index: 0, embedding: vector }] };
    });
    const bytes = await sharp(
      Buffer.from([255, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0, 255]),
      { raw: { width: 2, height: 2, channels: 3 } },
    )
      .png()
      .toBuffer();
    const image: SearchImage = {
      originalAssetId: 'original',
      canonicalViewId: 'view',
      bytes,
      region: { kind: 'rect', x: 0.5, y: 0, width: 0.5, height: 1 },
    };
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index,
      embedMultimodal: embed,
    }).embed(image, 'query');
    expect(result).toEqual({ success: true, data: vector });
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({
        model: index.embeddingModelId,
        inputType: 'query',
        truncation: false,
      }),
    );
    const request = observed.request;
    if (!request) {
      throw new Error('Image request was not sent');
    }
    expect(request).toMatchObject({
      model: index.embeddingModelId,
      inputType: 'query',
      truncation: false,
    });
    const content = request.inputs[0]!.content![0]!;
    if (content.type !== 'image_base64' || !content.imageBase64) {
      throw new Error('Image bytes were not sent');
    }
    const sent = Buffer.from(content.imageBase64.split(',')[1]!, 'base64');
    const decoded = await sharp(sent)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 1, height: 2, channels: 3 });
    expect([...decoded.data]).toEqual([0, 0, 255, 0, 0, 255]);
  });

  it('should mask pixels outside a polygon rather than embedding its entire bounding rectangle', async () => {
    const observed: {
      request?: Parameters<
        NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>
      >[0];
    } = {};
    const embed = vi.fn<
      NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>
    >(async (request) => {
      observed.request ??= request;

      return { data: [{ index: 0, embedding: vector }] };
    });
    const image = redImage;
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index,
      embedMultimodal: embed,
    }).embed(
      {
        ...image,
        region: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 0, y: 1 },
          ],
        },
      },
      'document',
    );
    expect(result.success).toBe(true);
    expect(embed).toHaveBeenCalledWith(
      expect.objectContaining({ inputType: 'document' }),
    );
    const request = observed.request;
    if (!request) {
      throw new Error('Image request was not sent');
    }
    expect(request).toMatchObject({ inputType: 'document' });
    const content = request.inputs[0]!.content![0]!;
    if (content.type !== 'image_base64' || !content.imageBase64) {
      throw new Error('Image bytes were not sent');
    }
    const sent = Buffer.from(content.imageBase64.split(',')[1]!, 'base64');
    expect([
      ...(await sharp(sent)
        .extract({ left: 2, top: 2, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ]).toEqual([255, 0, 0]);
    expect([
      ...(await sharp(sent)
        .extract({ left: 17, top: 17, width: 1, height: 1 })
        .raw()
        .toBuffer()),
    ]).toEqual([255, 255, 255]);
  });

  it.each([
    { name: 'wrong dimensions', data: [{ index: 0, embedding: [1, 2] }] },
    {
      name: 'zero vector',
      data: [{ index: 0, embedding: Array<number>(1024).fill(0) }],
    },
    {
      name: 'nonfinite vector',
      data: [{ index: 0, embedding: [Number.NaN, ...vector.slice(1)] }],
    },
    { name: 'wrong response index', data: [{ index: 1, embedding: vector }] },
    {
      name: 'multiple vectors',
      data: [
        { index: 0, embedding: vector },
        { index: 1, embedding: vector },
      ],
    },
    { name: 'missing vector', data: [] },
  ])('should reject $name from the provider', async ({ data }) => {
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index,
      embedMultimodal: async () => ({ data }),
    }).embed(redImage, 'query');
    expect(result).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY', retryable: false },
    });
  });

  it('should reject an incompatible embedding space before calling the provider', async () => {
    const embed =
      vi.fn<NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>>();
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index: { ...index, dimensions: 768 },
      embedMultimodal: embed,
    }).embed(redImage, 'query');
    expect(result).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY' },
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should reject corrupt canonical bytes without sending them to the provider', async () => {
    const embed =
      vi.fn<NonNullable<VoyageImageEmbeddingParams['embedMultimodal']>>();
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index,
      embedMultimodal: embed,
    }).embed(
      {
        originalAssetId: 'original',
        canonicalViewId: 'view',
        bytes: new Uint8Array([1, 2, 3]),
        region: null,
      },
      'query',
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('should report transient provider failure without inventing an embedding', async () => {
    const result = await createVoyageImageEmbedding({
      apiKey: 'test-only',
      index,
      embedMultimodal: async () => {
        throw new Error('Network unavailable');
      },
    }).embed(redImage, 'query');
    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    });
  });
});
