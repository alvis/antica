import { describe, expect, it, vi } from 'vitest';

import { createLlamaSourceParser } from './llama.js';

import type { LlamaSourceParserParams } from './llama.js';

const input = {
  sourceVersionId: 'book-version',
  parseRunId: 'parse-run',
  originalAssetId: 'page-photo',
};
const asset = {
  id: 'page-photo',
  mimeType: 'image/png',
  bytes: Uint8Array.from(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAD0lEQVR4nGNI357OgAQAwu8ViVzPDkgAAAAASUVORK5CYII=',
      'base64',
    ),
  ),
  printedPageLabel: '十二',
  view: {
    id: 'page-view',
    originalAssetId: 'page-photo',
    derivativeId: 'upright',
    width: 4,
    height: 3,
    originalCoordinateSpace: 'image_pixels' as const,
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
  },
};
const params: LlamaSourceParserParams = {
  apiKey: 'test-provider-key',
  parserVersion: '2026-09-01',
  readAsset: async () => asset,
  resolveSource: async () => ({ sourceId: 'book' }),
  writeArtifact: async () => 'artifact',
};

describe('fn:createLlamaSourceParser', () => {
  it('should reject unsupported original media before submitting to LlamaParse', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const parser = createLlamaSourceParser({
      ...params,
      fetch,
      readAsset: async () => ({ ...asset, mimeType: 'application/zip' }),
    });

    expect(await parser.submit(input)).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['FAILED', 'CANCELLED'])(
    'should reject a %s submission before persisting a provider handle',
    async (status) => {
      const parser = createLlamaSourceParser({
        ...params,
        fetch: async (url) =>
          url === 'data:,'
            ? new Response()
            : Response.json({ id: 'provider-job', status }),
      });

      expect(await parser.submit(input)).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    },
  );

  it('should surface submission transport failure as retryable', async () => {
    const parser = createLlamaSourceParser({
      ...params,
      fetch: async () => {
        throw new Error('Offline');
      },
    });

    expect(await parser.submit(input)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
      cause: expect.any(Error),
    });
  });

  it('should reject resume when the parser configuration is no longer usable', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const parser = createLlamaSourceParser({ ...params, apiKey: '', fetch });

    expect(
      await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should reject a resume handle without a provider job identity', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const parser = createLlamaSourceParser({ ...params, fetch });

    expect(
      await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: '',
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('should return local original-media validation failure after provider completion', async () => {
    const parser = createLlamaSourceParser({
      ...params,
      readAsset: async () => ({ ...asset, mimeType: 'application/zip' }),
      fetch: async () =>
        Response.json({
          job: { id: 'provider-job', status: 'COMPLETED' },
          text: { pages: [{ page_number: 1, text: 'Glaze' }] },
        }),
    });

    expect(
      await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'MEDIA_UNSUPPORTED', retryable: false },
    });
  });

  it('should preserve an empty provider page without a fabricated text region', async () => {
    const parser = createLlamaSourceParser({
      ...params,
      fetch: async () =>
        Response.json({
          job: { id: 'provider-job', status: 'COMPLETED' },
          text: { pages: [{ page_number: 1, text: '' }] },
        }),
    });

    expect(
      await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      }),
    ).toMatchObject({
      success: true,
      data: {
        kind: 'completed',
        pack: { pages: [{ rawText: '', regionIds: [] }], regions: [] },
      },
    });
  });

  it.each([{ apiKey: '' }, { parserVersion: 'latest' }])(
    'should reject unconfigured or unpinned parsing before upload: %j',
    async (override) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      const readAsset = vi.fn(params.readAsset);
      const result = await createLlamaSourceParser({
        ...params,
        ...override,
        fetch,
        readAsset,
      }).submit(input);
      expect(result).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
      expect(fetch).not.toHaveBeenCalled();
      expect(readAsset).not.toHaveBeenCalled();
    },
  );

  it('should persist a waiting provider handle and perform only one poll per resume', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (url === 'data:,') {
        return new Response();
      }
      if (new Request(url, init).method === 'POST') {
        const form = await new Request(url, init).formData();
        const file = form.get('file');
        if (!(file instanceof File)) {
          throw new Error('Missing original upload');
        }
        expect(new Uint8Array(await file.arrayBuffer())).toEqual(asset.bytes);
        const configuration = form.get('configuration');
        if (typeof configuration !== 'string') {
          throw new Error('Missing configuration');
        }
        expect(JSON.parse(configuration)).toMatchObject({
          version: params.parserVersion,
        });

        return Response.json({ id: 'provider-job', status: 'PENDING' });
      }

      return Response.json({ job: { id: 'provider-job', status: 'RUNNING' } });
    });
    const parser = createLlamaSourceParser({ ...params, fetch });
    const submitted = await parser.submit(input);
    expect(submitted).toMatchObject({
      success: true,
      data: {
        ...input,
        kind: 'waiting',
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      },
    });
    if (!submitted.success || submitted.data.kind !== 'waiting') {
      throw new Error('Provider job was not accepted');
    }
    expect(await parser.resume(submitted.data)).toMatchObject({
      success: true,
      data: { kind: 'waiting', providerJobId: 'provider-job' },
    });
    expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
      2,
    );
  });

  it('should retain completed provider output on the original page without inventing OCR bounds', async () => {
    const response = {
      job: { id: 'provider-job', status: 'COMPLETED' },
      text: { pages: [{ page_number: 1, text: 'Ａ釉色' }] },
    };
    const artifacts: Uint8Array[] = [];
    const parser = createLlamaSourceParser({
      ...params,
      fetch: async () => Response.json(response),
      writeArtifact: async (bytes) => {
        artifacts.push(bytes);

        return `artifact-${artifacts.length}`;
      },
    });

    const result = await parser.resume({
      ...input,
      provider: 'llama-parse',
      providerJobId: 'provider-job',
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        kind: 'completed',
        pack: {
          rawOutputAssetId: 'artifact-1',
          pages: [
            {
              originalAssetId: asset.id,
              printedPageLabel: '十二',
              rawText: 'Ａ釉色',
              searchText: 'a釉色',
              quality: 'needs_review',
              view: asset.view,
            },
          ],
          regions: [
            {
              rawText: 'Ａ釉色',
              region: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
            },
          ],
        },
      },
    });
    expect(JSON.parse(new TextDecoder().decode(artifacts[0]))).toEqual(
      response,
    );
  });

  it.each([
    [{ page_number: 0, text: 'wrong page' }],
    [
      { page_number: 1, text: 'first' },
      { page_number: 1, text: 'duplicate' },
    ],
    [],
  ])(
    'should reject incomplete or ambiguous page mapping %#',
    async (...pages) => {
      const parser = createLlamaSourceParser({
        ...params,
        fetch: async () =>
          Response.json({
            job: { id: 'provider-job', status: 'COMPLETED' },
            text: { pages },
          }),
      });

      const result = await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      });

      expect(result).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    },
  );

  it.each(['FAILED', 'CANCELLED'])(
    'should reject provider %s jobs',
    async (status) => {
      const parser = createLlamaSourceParser({
        ...params,
        fetch: async () =>
          Response.json({ job: { id: 'provider-job', status } }),
      });

      const result = await parser.resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      });

      expect(result).toMatchObject({
        success: false,
        error: { retryable: false },
      });
    },
  );

  it('should reject a provider response for another job', async () => {
    const parser = createLlamaSourceParser({
      ...params,
      fetch: async () =>
        Response.json({ job: { id: 'other-job', status: 'PENDING' } }),
    });

    const result = await parser.resume({
      ...input,
      provider: 'llama-parse',
      providerJobId: 'provider-job',
    });

    expect(result).toMatchObject({
      success: false,
      error: { retryable: false },
    });
  });

  it.each(['PENDING', 'RUNNING'])(
    'should keep %s jobs waiting without writing output',
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () =>
        Response.json({ job: { id: 'provider-job', status } }),
      );
      const writeArtifact = vi.fn<LlamaSourceParserParams['writeArtifact']>(
        async () => 'artifact',
      );

      const result = await createLlamaSourceParser({
        ...params,
        fetch,
        writeArtifact,
      }).resume({
        ...input,
        provider: 'llama-parse',
        providerJobId: 'provider-job',
      });

      expect(result).toMatchObject({
        success: true,
        data: { kind: 'waiting', providerJobId: 'provider-job' },
      });
      expect(fetch.mock.calls).toHaveLength(1);
      expect(writeArtifact.mock.calls).toEqual([]);
    },
  );

  it('should surface transport failure as retryable without polling', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('Offline');
    });

    const result = await createLlamaSourceParser({ ...params, fetch }).resume({
      ...input,
      provider: 'llama-parse',
      providerJobId: 'provider-job',
    });

    expect(result).toMatchObject({
      success: false,
      error: { retryable: true },
    });
    expect(fetch.mock.calls).toHaveLength(1);
  });
});

describe('Llama webhook registration and retention', () => {
  it.each([false, true])(
    'should register terminal callbacks only when configured: %s',
    async (configured) => {
      const webhook = {
        url: 'https://example.org/callback',
        signingSecret: 'test-signing-secret',
      };
      const requests: unknown[] = [];
      const parser = createLlamaSourceParser({
        ...params,
        ...(configured ? { webhook } : {}),
        fetch: async (url, init) => {
          if (url === 'data:,') {
            return new Response();
          }
          const form = await new Request(url, init).formData();
          const configuration = form.get('configuration');
          if (typeof configuration !== 'string') {
            throw new Error('Missing parse configuration');
          }
          requests.push(JSON.parse(configuration));

          return Response.json({ id: 'provider-job', status: 'PENDING' });
        },
      });

      const result = await parser.submit(input);

      expect(result).toMatchObject({
        success: true,
        data: { kind: 'waiting', providerJobId: 'provider-job' },
      });
      expect(requests).toEqual([
        {
          tier: 'agentic',
          version: params.parserVersion,
          ...(configured
            ? {
                webhook_configurations: [
                  {
                    webhook_url: webhook.url,
                    webhook_signing_secret: webhook.signingSecret,
                    webhook_output_format: 'json',
                    webhook_events: [
                      'parse.success',
                      'parse.error',
                      'parse.partial_success',
                      'parse.cancelled',
                    ],
                  },
                ],
              }
            : {}),
        },
      ]);
      expect(JSON.stringify(result)).not.toContain(webhook.signingSecret);
    },
  );

  it('should retain parsed text and geometry without echoed webhook credentials', async () => {
    const payload = {
      job: { id: 'provider-job', status: 'COMPLETED' },
      text: { pages: [{ page_number: 1, text: 'Glaze' }] },
      items: { pages: [] },
      raw_parameters: {
        webhook_configurations: [
          { webhook_signing_secret: 'test-signing-secret' },
        ],
      },
      job_metadata: { webhook_signing_secret: 'test-signing-secret' },
    };
    const artifacts: Uint8Array[] = [];
    const parser = createLlamaSourceParser({
      ...params,
      fetch: async () => Response.json(payload),
      writeArtifact: async (bytes) => {
        artifacts.push(bytes);

        return `artifact-${artifacts.length}`;
      },
    });

    const result = await parser.resume({
      ...input,
      provider: 'llama-parse',
      providerJobId: 'provider-job',
    });

    expect(result).toMatchObject({
      success: true,
      data: { kind: 'completed' },
    });
    expect(JSON.parse(new TextDecoder().decode(artifacts[0]))).toEqual({
      job: payload.job,
      text: payload.text,
      items: payload.items,
    });
    expect(
      artifacts.map((bytes) => new TextDecoder().decode(bytes)).join(''),
    ).not.toContain('test-signing-secret');
  });
});
