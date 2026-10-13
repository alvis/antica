import { describe, expect, it, vi } from 'vitest';

import { createLlamaTextRetrieval } from './llama.js';

import type { LlamaTextRetrievalParams } from './llama.js';
import type { TextSearchEntry } from './text.js';

const index = {
  embeddingModelId: 'embedding',
  dimensions: 8,
  indexVersion: 'v1',
};
const entry: TextSearchEntry = {
  summary: {
    id: 'knowledge',
    displayCode: 'K1',
    revision: 1,
    titleZhHant: '釉色',
    kinds: [],
    status: 'saved',
    summaryZhHant: '來源',
    citationCount: 1,
  },
  citation: {
    id: 'citation',
    relation: 'supports',
    availability: 'stored',
    verification: 'located',
    locator: {
      kind: 'web',
      sourceId: 'source',
      sourceVersionId: 'version',
      url: 'https://example.org/book',
      retrievedAt: '2026-10-13T00:00:00.000Z',
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: 'Original passage',
    },
  },
  contentAsRetrieved: 'Original passage',
  sourceRegionId: 'region',
};
const item = {
  metadata: { anticaOwnerId: 'owner', anticaIndexVersion: 'v1' },
  content: entry.contentAsRetrieved,
  static_fields: { parsed_directory_file_id: 'file', chunk_index: 0 },
};
const params = {
  ownerId: 'owner',
  apiKey: 'test-key',
  indexId: 'index',
  index,
  resolveChunk: async () => entry,
} satisfies LlamaTextRetrievalParams;

describe('fn:createLlamaTextRetrieval', () => {
  it('should reject a malformed pagination token after resolving provider results', async () => {
    const adapter = createLlamaTextRetrieval({
      ...params,
      fetch: async () => Response.json({ results: [item] }),
    });
    expect(await adapter.search({ cursor: 'not-json' }, index)).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
  });
  it('should apply canonical kinds, status, and source filters to provider matches', async () => {
    const selected: TextSearchEntry = {
      ...entry,
      summary: { ...entry.summary, kinds: ['material'] },
    };
    const adapter = createLlamaTextRetrieval({
      ...params,
      resolveChunk: async () => selected,
      fetch: async () => Response.json({ results: [item] }),
    });
    expect(
      await adapter.search(
        {
          kinds: ['material'],
          status: 'saved',
          filters: { sourceIds: ['source'] },
        },
        index,
      ),
    ).toEqual({
      success: true,
      data: { items: [selected.summary], nextCursor: null },
    });
    expect(await adapter.search({ kinds: ['condition'] }, index)).toEqual({
      success: true,
      data: { items: [], nextCursor: null },
    });
    expect(
      await adapter.search({ filters: { sourceIds: ['foreign'] } }, index),
    ).toEqual({ success: true, data: { items: [], nextCursor: null } });
  });
  it('should reject results from a different owner or index before resolving canonical content', async () => {
    const resolveChunk = vi.fn<LlamaTextRetrievalParams['resolveChunk']>(
      async () => entry,
    );
    for (const metadata of [
      { anticaOwnerId: 'foreign', anticaIndexVersion: 'v1' },
      { anticaOwnerId: 'owner', anticaIndexVersion: 'old' },
    ]) {
      const adapter = createLlamaTextRetrieval({
        ...params,
        resolveChunk,
        fetch: async () => Response.json({ results: [{ ...item, metadata }] }),
      });
      expect(await adapter.snapshot('glaze', index)).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    }
    expect(resolveChunk.mock.calls).toEqual([]);
  });
  it('should reject incomplete configuration and unsupported filters before provider access', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ results: [] }),
    );
    for (const change of [{ apiKey: '' }, { indexId: '' }, { ownerId: '' }]) {
      expect(
        await createLlamaTextRetrieval({ ...params, ...change, fetch }).search(
          {},
          index,
        ),
      ).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE', retryable: false },
      });
    }
    expect(
      await createLlamaTextRetrieval({ ...params, fetch }).search(
        { filters: { materialIds: ['clay'] } },
        index,
      ),
    ).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    expect(fetch.mock.calls).toEqual([]);
  });
  it('should query the owner scope and return retained canonical evidence', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ results: [item, item, { ...item, content: ' ' }] }),
    );
    const resolveChunk = vi.fn<LlamaTextRetrievalParams['resolveChunk']>(
      async () => entry,
    );

    const result = await createLlamaTextRetrieval({
      ...params,
      fetch,
      resolveChunk,
    }).snapshot('glaze', index);

    expect(result).toMatchObject({
      success: true,
      data: {
        citations: [entry.citation],
        text: [
          {
            citationId: 'citation',
            contentAsRetrieved: entry.contentAsRetrieved,
            sourceRegionId: 'region',
          },
        ],
      },
    });
    expect(await new Request(...fetch.mock.calls[0]!).json()).toMatchObject({
      query: 'glaze',
      custom_filters: { anticaOwnerId: { operator: 'eq', value: 'owner' } },
    });
    expect(resolveChunk.mock.calls).toEqual([
      [
        {
          fileId: 'file',
          chunkIndex: 0,
          contentAsRetrieved: entry.contentAsRetrieved,
        },
      ],
      [
        {
          fileId: 'file',
          chunkIndex: 0,
          contentAsRetrieved: entry.contentAsRetrieved,
        },
      ],
    ]);
  });

  it.each([
    null,
    { ...entry, contentAsRetrieved: 'Transformed passage' },
    {
      ...entry,
      citation: { ...entry.citation, verification: 'needs_review' as const },
    },
    {
      ...entry,
      citation: { ...entry.citation, availability: 'unavailable' as const },
    },
  ])(
    'should reject absent or untrustworthy canonical mappings %#',
    async (mapped) => {
      const adapter = createLlamaTextRetrieval({
        ...params,
        fetch: async () => Response.json({ results: [item] }),
        resolveChunk: async () => mapped,
      });

      const result = await adapter.snapshot('glaze', index);

      expect(result).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    },
  );

  it.each([
    {},
    { parsed_directory_file_id: 'file', chunk_index: null },
    { parsed_directory_file_id: 'file', chunk_index: -1 },
    { parsed_directory_file_id: 'file', chunk_index: 0.5 },
  ])(
    'should reject unmappable provider chunk identifiers %#',
    async (staticFields) => {
      const adapter = createLlamaTextRetrieval({
        ...params,
        fetch: async () =>
          Response.json({
            results: [{ ...item, static_fields: staticFields }],
          }),
      });

      const result = await adapter.search({ q: 'glaze' }, index);

      expect(result).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    },
  );

  it('should reject another embedding space before querying the provider', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ results: [] }),
    );

    const result = await createLlamaTextRetrieval({
      ...params,
      fetch,
    }).snapshot('glaze', { ...index, dimensions: 16 });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'INDEX_NOT_READY', retryable: false },
    });
    expect(fetch.mock.calls).toEqual([]);
  });

  it('should return a retryable provider error without falling back to local search', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: 'Unavailable' }, { status: 503 }),
    );

    const result = await createLlamaTextRetrieval({ ...params, fetch }).search(
      { q: 'glaze' },
      index,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: true },
    });
    expect(fetch.mock.calls).toHaveLength(1);
  });

  it('should paginate unique results and reject a cursor reused for a different query', async () => {
    const second = { ...entry, summary: { ...entry.summary, id: 'second' } };
    const adapter = createLlamaTextRetrieval({
      ...params,
      fetch: async () =>
        Response.json({
          results: [
            item,
            {
              ...item,
              static_fields: {
                parsed_directory_file_id: 'second',
                chunk_index: 0,
              },
            },
          ],
        }),
      resolveChunk: async ({ fileId }) => (fileId === 'file' ? entry : second),
    });

    const first = await adapter.search({ q: 'glaze', limit: 1 }, index);
    if (!first.success || !first.data.nextCursor) {
      throw new Error('Expected a second page');
    }
    const next = await adapter.search(
      { q: 'glaze', limit: 1, cursor: first.data.nextCursor },
      index,
    );
    const changed = await adapter.search(
      { q: 'bronze', limit: 1, cursor: first.data.nextCursor },
      index,
    );

    expect(first.data.items).toEqual([entry.summary]);
    expect(next).toEqual({
      success: true,
      data: { items: [second.summary], nextCursor: null },
    });
    expect(changed).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
  });
});
