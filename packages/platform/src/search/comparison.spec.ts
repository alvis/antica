import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { imageComparisonSchema } from '@antica/contracts';

import { MockLanguageModelV4 } from 'ai/test';

import { createCloudImageComparison } from './comparison.js';

import type {
  ImageComparison,
  ImageCompareRequest,
  Region,
} from '@antica/contracts';

import type { ModelProfile } from '../ai/capability.js';

import type { CloudImageComparisonParams } from './comparison.js';
import type { ImageSearchEntry, SearchImage } from './image.js';

const ids = {
  query: '10000000-0000-4000-8000-000000000001',
  queryView: '10000000-0000-4000-8000-000000000002',
  selected: '10000000-0000-4000-8000-000000000003',
  selectedView: '10000000-0000-4000-8000-000000000004',
  record: '10000000-0000-4000-8000-000000000005',
  source: '10000000-0000-4000-8000-000000000006',
  sourceVersion: '10000000-0000-4000-8000-000000000007',
  foreign: '10000000-0000-4000-8000-000000000099',
};
const index = {
  embeddingModelId: 'voyage:test',
  dimensions: 8,
  indexVersion: 'fixture-v1',
};
const profile: ModelProfile = {
  modelId: 'gateway:comparison-fixture',
  provider: 'gateway',
  providerModelVersion: null,
  adapterKind: 'live',
  roles: ['research', 'analysis'],
  capabilities: {
    textInput: true,
    imageInput: true,
    audioInput: false,
    structuredOutput: true,
    toolCalling: false,
    maxImages: 2,
  },
};
const request: ImageCompareRequest = {
  mode: 'compare',
  queryAnchorId: ids.query,
  selected: {
    kind: 'collection',
    recordId: ids.record,
    originalAssetId: ids.selected,
  },
  selectedCanonicalViewId: ids.selectedView,
  selectedRegion: { kind: 'rect', x: 0.5, y: 0, width: 0.5, height: 0.5 },
};
const promptSchema = z.object({
  frozen: imageComparisonSchema.omit({
    similaritiesZhHant: true,
    differencesZhHant: true,
    limitsZhHant: true,
  }),
});

/**
 * echoes server-owned references through the actual AI SDK structured-output path
 * @param transform optional adversarial mutation of an otherwise valid response
 * @returns offline SDK provider fixture
 */
function createProvider(
  transform: (output: ImageComparison) => unknown = (output) => output,
): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    modelId: profile.modelId,
    doGenerate: async ({ prompt }) => {
      const user = prompt.find((message) => message.role === 'user');
      const text = user?.content.find((part) => part.type === 'text');
      if (!text) {
        throw new Error('Expected the comparison evidence prompt');
      }
      const payload = promptSchema.parse(JSON.parse(text.text));
      const output: ImageComparison = {
        ...payload.frozen,
        similaritiesZhHant: ['兩者均有直線。 / Both show straight lines.'],
        differencesZhHant: ['左圖紅色，右圖藍色。 / Red versus blue.'],
        limitsZhHant: ['光線可能不同。 / Lighting may differ.'],
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(transform(output)) }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 20, text: 20, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/**
 * supplies actual two-color canonical PNG bytes and observable authorized readers
 * @param model offline structured provider
 * @param images authorized query region and selected source reference
 * @param images.queryRegion selected query geometry
 * @param images.selectedMatch selected reference and its source locator
 * @returns isolated comparison dependencies
 */
async function createFixture(
  model = createProvider(),
  images: {
    queryRegion?: Region;
    selectedMatch?: Pick<ImageSearchEntry['match'], 'ref' | 'sourceLocator'>;
  } = {},
) {
  const raw = Buffer.from(
    Array.from({ length: 16 }, (_, pixel) =>
      pixel % 4 < 2 ? [255, 0, 0] : [0, 0, 255],
    ).flat(),
  );
  const bytes = await sharp(raw, { raw: { width: 4, height: 4, channels: 3 } })
    .png()
    .toBuffer();
  const query: SearchImage = {
    originalAssetId: ids.query,
    canonicalViewId: ids.queryView,
    bytes,
    region: images.queryRegion ?? {
      kind: 'rect',
      x: 0,
      y: 0,
      width: 0.5,
      height: 1,
    },
  };
  const selected: ImageSearchEntry = {
    image: {
      originalAssetId: ids.selected,
      canonicalViewId: ids.selectedView,
      bytes,
      region: null,
    },
    match: {
      ref: request.selected,
      matchingRegions: [],
      thumbnail: null,
      sourceLocator: null,
      sourceTitle: null,
      contributorNames: [],
      warningsZhHant: [],
      ...images.selectedMatch,
    },
    filterIds: {
      objectTypeIds: [],
      materialIds: [],
      periodIds: [],
      regionIds: [],
      sourceIds: [],
    },
  };
  const readQuery = vi.fn(async () => query);
  const readSelected = vi.fn<CloudImageComparisonParams['readSelected']>(
    async () => selected,
  );
  const params: CloudImageComparisonParams = {
    models: {
      profiles: [profile],
      languageModels: { [profile.modelId]: model },
    },
    selection: {
      modelId: profile.modelId,
      role: 'research',
      profileVersion: 'fixture-v1',
    },
    index,
    readQuery,
    readSelected,
  };

  return { params, query, selected, model, readQuery, readSelected };
}

/**
 * checks decoded pixels rather than identifiers or image part counts alone
 * @param image SDK image content bytes
 * @param expected expected dimensions and RGB triplet
 * @param expected.width cropped width in pixels
 * @param expected.height cropped height in pixels
 * @param expected.color RGB triplet repeated throughout the crop
 */
async function expectPixels(
  image: unknown,
  expected: { width: number; height: number; color: number[] },
): Promise<void> {
  const { width, height, color } = expected;
  const decoded = await sharp(decodeImage(image))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect(decoded.info).toMatchObject({ width, height, channels: 3 });
  expect([...decoded.data]).toEqual(
    Array.from({ length: width * height }, () => color).flat(),
  );
}

/**
 * decodes the SDK's inline file-data envelope while rejecting remote image URLs
 * @param image normalized provider file data
 * @returns embedded PNG bytes
 */
function decodeImage(image: unknown): Uint8Array {
  const { data } = z
    .object({
      type: z.literal('data'),
      data: z.union([z.instanceof(Uint8Array), z.string()]),
    })
    .parse(image);

  return typeof data === 'string' ? Buffer.from(data, 'base64') : data;
}

describe('fn:createCloudImageComparison', () => {
  it('should bind a stored page citation to its canonical view and reject a different page view', async () => {
    const fixture = await createFixture();
    const ref = {
      kind: 'reference' as const,
      sourceVersionId: ids.sourceVersion,
      referenceImageId: ids.selected,
    };
    const locator = {
      kind: 'page' as const,
      sourceId: ids.source,
      sourceVersionId: ids.sourceVersion,
      pageId: ids.selected,
      canonicalViewId: ids.selectedView,
      pageIndex: 0,
      printedPageLabel: null,
      regionId: null,
      region: null,
      textRange: null,
    };
    const readSelected = async () => ({
      ...fixture.selected,
      match: { ...fixture.selected.match, ref, sourceLocator: locator },
    });
    const result = await createCloudImageComparison({
      ...fixture.params,
      readSelected,
    })({ ...request, selected: ref }, index);
    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          citations: [
            { locator, availability: 'stored', verification: 'located' },
          ],
        },
      },
    });
    const mismatch = await createCloudImageComparison({
      ...fixture.params,
      readSelected: async () => ({
        ...fixture.selected,
        match: {
          ...fixture.selected.match,
          ref,
          sourceLocator: { ...locator, canonicalViewId: ids.foreign },
        },
      }),
    })({ ...request, selected: ref }, index);
    expect(mismatch).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
  });
  it('should send actual independently cropped pixel pairs and retain frozen identity without tools', async () => {
    const provideComparison = vi.fn((output: ImageComparison) => output);
    const fixture = await createFixture(createProvider(provideComparison));
    const result = await createCloudImageComparison(fixture.params)(
      request,
      index,
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          queryAnchorId: ids.query,
          selected: request.selected,
          selectedRegion: request.selectedRegion,
          selectedCanonicalViewId: ids.selectedView,
          citations: [],
        },
        invocation: {
          requestedModelId: profile.modelId,
          effectiveModelId: profile.modelId,
          role: 'research',
          profileVersion: 'fixture-v1',
          promptVersion: 'image-comparison-v1',
          schemaVersion: 'image-comparison-v1',
          adapterKind: 'live',
          usage: { inputTokens: 10, outputTokens: 20 },
          latencyMs: expect.any(Number),
        },
      },
    });
    if (!result.success) {
      throw new Error('Expected valid comparison');
    }
    const providerOutput = provideComparison.mock.results[0]!.value;
    expect(result.data.value).toEqual({
      ...providerOutput,
      limitsZhHant: [...providerOutput.limitsZhHant, expect.any(String)],
    });
    expect(
      result.data.value.limitsZhHant.at(-1)!.trim().length,
    ).toBeGreaterThan(0);
    const invocation = fixture.model.doGenerateCalls[0]!;
    const parts = invocation.prompt.flatMap((message) =>
      message.role === 'user' ? message.content : [],
    );
    const images = parts.filter((part) => part.type === 'file');
    expect(images).toHaveLength(2);
    await expectPixels(images[0]!.data, {
      width: 2,
      height: 4,
      color: [255, 0, 0],
    });
    await expectPixels(images[1]!.data, {
      width: 2,
      height: 2,
      color: [0, 0, 255],
    });
    expect(invocation.tools ?? []).toEqual([]);
    expect(fixture.readQuery).toHaveBeenCalledWith(ids.query);
    expect(fixture.readSelected).toHaveBeenCalledWith(request);
  });

  it('should mask polygon pixels outside the selection before sending the pair', async () => {
    const fixture = await createFixture(createProvider(), {
      queryRegion: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    });
    expect(
      await createCloudImageComparison(fixture.params)(
        { ...request, selectedRegion: null },
        index,
      ),
    ).toMatchObject({ success: true });
    const images = fixture.model.doGenerateCalls[0]!.prompt.flatMap(
      (message) => (message.role === 'user' ? message.content : []),
    ).filter((part) => part.type === 'file');
    const bytes = decodeImage(images[0]!.data);
    const decoded = await sharp(bytes)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(decoded.info).toMatchObject({ width: 4, height: 4 });
    expect([...decoded.data.subarray(0, 3)]).toEqual([255, 0, 0]);
    expect([...decoded.data.subarray(-3)]).toEqual([255, 255, 255]);
  });

  it('should reject a reference image whose locator points to a different source version', async () => {
    const fixture = await createFixture();
    const ref = {
      kind: 'reference' as const,
      sourceVersionId: ids.sourceVersion,
      referenceImageId: ids.selected,
    };
    fixture.readSelected.mockResolvedValue({
      ...fixture.selected,
      match: {
        ...fixture.selected.match,
        ref,
        sourceLocator: {
          kind: 'web',
          sourceId: ids.source,
          sourceVersionId: ids.foreign,
          url: 'https://example.invalid/reference',
          retrievedAt: '2026-01-01T00:00:00.000Z',
          snapshotAssetId: null,
          blockId: null,
          excerptAsRetrieved: null,
        },
      },
    });
    expect(
      await createCloudImageComparison(fixture.params)(
        { ...request, selected: ref },
        index,
      ),
    ).toMatchObject({ success: false, error: { code: 'SOURCE_UNAVAILABLE' } });
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
  });

  it.each([
    { name: 'unknown model', change: { profiles: [] }, code: 'MODEL_UNKNOWN' },
    {
      name: 'text-only model',
      change: {
        profiles: [
          {
            ...profile,
            capabilities: { ...profile.capabilities, imageInput: false },
          },
        ],
      },
      code: 'MODEL_CAPABILITY_MISMATCH',
    },
    {
      name: 'unstructured model',
      change: {
        profiles: [
          {
            ...profile,
            capabilities: { ...profile.capabilities, structuredOutput: false },
          },
        ],
      },
      code: 'MODEL_CAPABILITY_MISMATCH',
    },
    {
      name: 'single-image model',
      change: {
        profiles: [
          {
            ...profile,
            capabilities: { ...profile.capabilities, maxImages: 1 },
          },
        ],
      },
      code: 'MODEL_CAPABILITY_MISMATCH',
    },
    {
      name: 'development model',
      change: {
        profiles: [{ ...profile, adapterKind: 'development' as const }],
      },
      code: 'MODEL_CAPABILITY_MISMATCH',
    },
  ])(
    'should reject $name before reading images or calling the provider',
    async ({ change, code }) => {
      const fixture = await createFixture();
      const compare = createCloudImageComparison({
        ...fixture.params,
        models: { ...fixture.params.models, ...change },
      });
      expect(await compare(request, index)).toMatchObject({
        success: false,
        error: { code, retryable: false },
      });
      expect(fixture.readQuery).not.toHaveBeenCalled();
      expect(fixture.model.doGenerateCalls).toHaveLength(0);
    },
  );

  it('should reject an incompatible index and a non-research role before image reads', async () => {
    const fixture = await createFixture();
    expect(
      await createCloudImageComparison(fixture.params)(request, {
        ...index,
        indexVersion: 'foreign',
      }),
    ).toMatchObject({ success: false, error: { code: 'INDEX_NOT_READY' } });
    expect(
      await createCloudImageComparison({
        ...fixture.params,
        selection: { ...fixture.params.selection, role: 'analysis' },
      })(request, index),
    ).toMatchObject({
      success: false,
      error: { code: 'MODEL_CAPABILITY_MISMATCH' },
    });
    expect(fixture.readQuery).not.toHaveBeenCalled();
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
  });

  it('should preserve provider-authored non-authenticity uncertainty and append nonempty server limits', async () => {
    const provideUncertainty = vi.fn((output: ImageComparison) => ({
      ...output,
      limitsZhHant: [
        '不能據此判定真偽。 / Images do not establish age, origin, or authenticity.',
      ],
    }));
    const fixture = await createFixture(createProvider(provideUncertainty));

    const result = await createCloudImageComparison(fixture.params)(
      request,
      index,
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error('Expected provider uncertainty to remain valid');
    }
    const providerOutput = provideUncertainty.mock.results[0]!.value;
    expect(result.data.value).toEqual({
      ...providerOutput,
      limitsZhHant: [...providerOutput.limitsZhHant, expect.any(String)],
    });
    expect(
      result.data.value.limitsZhHant.at(-1)!.trim().length,
    ).toBeGreaterThan(0);
  });

  it('should reject provider mutation of query identity and retain its failure audit', async () => {
    const changeQueryIdentity = vi.fn((output: ImageComparison) => ({
      ...output,
      queryAnchorId: ids.foreign,
    }));
    const fixture = await createFixture(createProvider(changeQueryIdentity));

    const result = await createCloudImageComparison(fixture.params)(
      request,
      index,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID', retryable: false },
      audit: {
        invocation: {
          requestedModelId: profile.modelId,
          effectiveModelId: profile.modelId,
          citationCheck: { valid: false, rejectedReferenceIds: [] },
        },
        rawOutput: changeQueryIdentity.mock.results[0]!.value,
      },
    });
  });

  it.each([
    {
      name: 'selected identity',
      mutate: (output: ImageComparison) => ({
        ...output,
        selected: {
          kind: 'collection',
          recordId: ids.foreign,
          originalAssetId: ids.selected,
        },
      }),
    },
    {
      name: 'selected region',
      mutate: (output: ImageComparison) => ({
        ...output,
        selectedRegion: null,
      }),
    },
    {
      name: 'canonical view',
      mutate: (output: ImageComparison) => ({
        ...output,
        selectedCanonicalViewId: ids.foreign,
      }),
    },
    {
      name: 'unknown price field',
      mutate: (output: ImageComparison) => ({ ...output, price: 999 }),
    },
  ])('should reject provider mutation of $name', async ({ mutate }) => {
    const fixture = await createFixture(createProvider(mutate));
    expect(
      await createCloudImageComparison(fixture.params)(request, index),
    ).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should preserve source image citations and reject changed citation locators', async () => {
    for (const alter of [false, true]) {
      const ref = {
        kind: 'reference' as const,
        sourceVersionId: ids.sourceVersion,
        referenceImageId: ids.selected,
      };
      const locator = {
        kind: 'web' as const,
        sourceId: ids.source,
        sourceVersionId: ids.sourceVersion,
        url: 'https://example.invalid/reference',
        retrievedAt: '2026-01-01T00:00:00.000Z',
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      };
      const fixture = await createFixture(
        createProvider((output) =>
          alter
            ? {
                ...output,
                citations: output.citations.map((citation) => ({
                  ...citation,
                  locator: {
                    ...citation.locator,
                    sourceVersionId: ids.foreign,
                  },
                })),
              }
            : output,
        ),
        { selectedMatch: { ref, sourceLocator: locator } },
      );
      const result = await createCloudImageComparison(fixture.params)(
        { ...request, selected: ref },
        index,
      );
      expect(result).toMatchObject(
        alter
          ? { success: false, error: { code: 'MODEL_OUTPUT_INVALID' } }
          : {
              success: true,
              data: {
                value: {
                  citations: [
                    {
                      locator,
                      relation: 'comparison',
                      availability: 'link_only',
                      verification: 'located',
                    },
                  ],
                },
              },
            },
      );
    }
  });

  it.each(['missing', 'reference', 'view', 'asset', 'reader'] as const)(
    'should return a typed source failure for %s mismatch',
    async (reason) => {
      const fixture = await createFixture();
      if (reason === 'missing') {
        fixture.readSelected.mockResolvedValue(null);
      }
      if (reason === 'reader') {
        fixture.readQuery.mockRejectedValue(new Error('Unauthorized source'));
      }
      if (reason === 'reference') {
        fixture.readSelected.mockResolvedValue({
          ...fixture.selected,
          match: {
            ...fixture.selected.match,
            ref: {
              kind: 'collection',
              recordId: ids.foreign,
              originalAssetId: ids.selected,
            },
          },
        });
      }
      if (reason === 'view') {
        fixture.readSelected.mockResolvedValue({
          ...fixture.selected,
          image: { ...fixture.selected.image, canonicalViewId: ids.foreign },
        });
      }
      if (reason === 'asset') {
        fixture.readSelected.mockResolvedValue({
          ...fixture.selected,
          image: { ...fixture.selected.image, originalAssetId: ids.foreign },
        });
      }
      expect(
        await createCloudImageComparison(fixture.params)(request, index),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
      expect(fixture.model.doGenerateCalls).toHaveLength(0);
    },
  );

  it.each([
    { kind: 'rect', x: -0.1, y: 0, width: 0.5, height: 1 },
    { kind: 'rect', x: 0, y: 0, width: 0, height: 1 },
    {
      kind: 'polygon',
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    },
  ] satisfies Region[])(
    'should reject invalid selected regions before provider execution',
    async (selectedRegion) => {
      const fixture = await createFixture();
      expect(
        await createCloudImageComparison(fixture.params)(
          { ...request, selectedRegion },
          index,
        ),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(fixture.model.doGenerateCalls).toHaveLength(0);
    },
  );

  it('should return typed failures for corrupt pixels and SDK provider errors without fallback', async () => {
    const fixture = await createFixture();
    fixture.readQuery.mockResolvedValue({
      ...fixture.query,
      bytes: Buffer.from('invalid PNG'),
    });
    expect(
      await createCloudImageComparison(fixture.params)(request, index),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(fixture.model.doGenerateCalls).toHaveLength(0);
    const failedModel = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('SDK provider unavailable');
      },
    });
    const providerFailure = await createFixture(failedModel);
    expect(
      await createCloudImageComparison(providerFailure.params)(request, index),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
    });
    expect(failedModel.doGenerateCalls).toHaveLength(1);
  });
});
