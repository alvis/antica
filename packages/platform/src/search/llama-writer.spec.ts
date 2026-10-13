import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createLlamaTextIndexWriter } from './llama-writer.js';

import type {
  OperationResult,
  TextIndexHandle,
  TextIndexProgress,
} from '@antica/application/ports';

import type { LlamaTextIndexWriterParams } from './llama-writer.js';

const index = {
  embeddingModelId: 'embedding',
  dimensions: 8,
  indexVersion: 'v1',
};
const chunk = {
  sourceVersionId: 'source-v1',
  parseRunId: 'parse-1',
  citationId: 'citation-1',
  canonicalRegionIds: ['region-1'],
  contentAsRetrieved: 'Complete canonical passage.',
};
const input = {
  index,
  sourceVersionId: chunk.sourceVersionId,
  parseRunId: chunk.parseRunId,
  chunks: [chunk],
};
const metadata = {
  anticaOwnerId: 'owner',
  anticaSourceVersionId: chunk.sourceVersionId,
  anticaParseRunId: chunk.parseRunId,
  anticaCitationId: chunk.citationId,
  anticaIndexVersion: index.indexVersion,
  anticaRegionIds: chunk.canonicalRegionIds,
};
const providerChunk = {
  content: chunk.contentAsRetrieved,
  metadata,
  static_fields: { parsed_directory_file_id: 'file-1', chunk_index: 0 },
};
const remoteIndex = {
  id: 'index',
  source_directory_id: 'directory',
  last_exported_at: 'old',
};

function waiting(result: OperationResult<TextIndexProgress>): TextIndexHandle {
  if (!result.success || result.data.kind !== 'waiting') {
    throw new Error(
      `Expected a waiting continuation: ${JSON.stringify(result)}`,
    );
  }

  return result.data;
}

function fixture(response: unknown, phase = 'map') {
  const artifacts = new Map<string, Uint8Array>();
  const fetch = vi.fn<typeof globalThis.fetch>(async () =>
    Response.json(response),
  );
  const params = {
    ownerId: 'owner',
    apiKey: 'test-key',
    indexId: 'index',
    sourceDirectoryId: 'directory',
    index,
    fetch,
    readCheckpoint: async (id: string) => {
      const bytes = artifacts.get(id);
      if (!bytes) {
        throw new Error('Missing checkpoint');
      }

      return bytes;
    },
    writeCheckpoint: async (bytes: Uint8Array) => {
      const id = `checkpoint-${artifacts.size}`;
      artifacts.set(id, bytes);

      return id;
    },
  } satisfies LlamaTextIndexWriterParams;
  const checkpoint = {
    version: 1,
    ownerId: params.ownerId,
    indexId: params.indexId,
    sourceDirectoryId: params.sourceDirectoryId,
    sourceVersionId: input.sourceVersionId,
    parseRunId: input.parseRunId,
    index,
    phase,
    chunks: [chunk],
    providerDocumentIds: ['file-1'],
    mappings: [],
    mappedCount: 0,
    previousExport: 'old',
  };
  artifacts.set(
    'checkpoint',
    new TextEncoder().encode(JSON.stringify(checkpoint)),
  );
  const handle = {
    sourceVersionId: input.sourceVersionId,
    parseRunId: input.parseRunId,
    index,
    provider: 'llama-cloud',
    providerJobId: null,
    providerDocumentIds: ['file-1'],
    checkpointAssetId: 'checkpoint',
  } satisfies TextIndexHandle;

  return {
    writer: createLlamaTextIndexWriter(params),
    params,
    handle,
    fetch,
    artifacts,
  };
}

describe('fn:createLlamaTextIndexWriter', () => {
  it('should distinguish definitive upload rejection from ambiguous outcomes and reject altered upload identity', async () => {
    for (const scenario of [
      'unauthorized',
      'conflict',
      'disconnect',
      'altered',
    ] as const) {
      const { params } = fixture(remoteIndex);
      const inspected = waiting(
        await createLlamaTextIndexWriter(params).resume(
          waiting(await createLlamaTextIndexWriter(params).submit(input)),
        ),
      );
      const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
        if (url === 'data:,') {
          return new Response();
        }
        if (scenario === 'disconnect') {
          throw new Error('Connection interrupted');
        }
        if (scenario === 'altered') {
          return Response.json({
            id: 'unbound-file',
            directory_id: 'foreign-directory',
            unique_id: 'foreign-content',
          });
        }

        return Response.json(
          { error: 'Upload rejected' },
          { status: scenario === 'unauthorized' ? 401 : 409 },
        );
      });
      const result = await createLlamaTextIndexWriter({
        ...params,
        fetch,
      }).resume(inspected);
      expect(result).toMatchObject(
        scenario === 'conflict' || scenario === 'disconnect'
          ? {
              success: true,
              data: { kind: 'waiting', providerDocumentIds: [] },
            }
          : {
              success: false,
              error: {
                code: 'SOURCE_UNAVAILABLE',
                retryable: scenario === 'unauthorized',
              },
            },
      );
    }
  });
  it('should fail closed on conflicting canonical mappings retained from an earlier chunk', async () => {
    const { writer, handle, artifacts } = fixture({ results: [providerChunk] });
    const retained = JSON.parse(
      new TextDecoder().decode(artifacts.get('checkpoint')),
    );
    artifacts.set(
      'checkpoint',
      new TextEncoder().encode(
        JSON.stringify({
          ...retained,
          mappings: [
            {
              provider: 'llama-cloud',
              providerChunkId: 'file-1:0',
              providerFigureId: null,
              parseRunId: chunk.parseRunId,
              indexVersion: index.indexVersion,
              sourceVersionId: chunk.sourceVersionId,
              canonicalRegionIds: ['different-retained-region'],
            },
          ],
        }),
      ),
    );
    expect(await writer.resume(handle)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
  });
  it('should reject changed remote directory identity and inconsistent retained cursors', async () => {
    for (const phase of ['inspect', 'wait']) {
      const { writer, handle } = fixture(
        { ...remoteIndex, source_directory_id: 'foreign' },
        phase,
      );
      expect(await writer.resume(handle)).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    }
    const upload = fixture({}, 'upload');
    expect(await upload.writer.resume(upload.handle)).toMatchObject({
      success: false,
      error: { retryable: false },
    });
    expect(upload.fetch.mock.calls).toEqual([]);
    const mapping = fixture({ results: [providerChunk] });
    const retained = mapping.artifacts.get('checkpoint')!;
    mapping.artifacts.set(
      'checkpoint',
      new TextEncoder().encode(
        JSON.stringify({
          ...JSON.parse(new TextDecoder().decode(retained)),
          mappedCount: 1,
        }),
      ),
    );
    expect(await mapping.writer.resume(mapping.handle)).toMatchObject({
      success: false,
      error: { retryable: false },
    });
    expect(mapping.fetch.mock.calls).toEqual([]);
  });
  it('should recover an ambiguous upload and map multiple canonical chunks across bounded continuations', async () => {
    const second = {
      ...chunk,
      citationId: 'citation-2',
      canonicalRegionIds: ['region-2'],
      contentAsRetrieved: 'A second retained passage.',
    };
    const { params } = fixture(remoteIndex);
    const upload = vi.fn(async (request: Request) => {
      const form = await request.formData();
      const metadata = JSON.parse(form.get('metadata') as string);

      return Response.json({
        id: metadata.anticaCitationId,
        directory_id: 'directory',
        unique_id: form.get('unique_id'),
        metadata,
      });
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (url === 'data:,') {
        return new Response();
      }
      const request = new Request(url, init);
      if (request.method === 'GET' && request.url.includes('/files')) {
        return Response.json({ items: [] });
      }
      if (request.method === 'GET') {
        return Response.json({
          ...remoteIndex,
          last_exported_at: 'new',
          metadata: { status: 'ready' },
          sync_in_progress: false,
        });
      }
      if (request.headers.get('content-type')?.includes('multipart')) {
        return upload(request);
      }
      if (request.url.includes('/sync')) {
        return Response.json({});
      }
      const body = z.object({ query: z.string() }).parse(await request.json());
      const current = body.query === chunk.contentAsRetrieved ? chunk : second;

      return Response.json({
        results: [
          {
            content: current.contentAsRetrieved,
            metadata: {
              ...metadata,
              anticaCitationId: current.citationId,
              anticaRegionIds: current.canonicalRegionIds,
            },
            static_fields: {
              parsed_directory_file_id: current.citationId,
              chunk_index: 0,
            },
          },
        ],
      });
    });
    const writer = createLlamaTextIndexWriter({ ...params, fetch });
    const submitted = waiting(
      await writer.submit({ ...input, chunks: [chunk, second] }),
    );
    const inspected = waiting(
      await createLlamaTextIndexWriter(params).resume(submitted),
    );
    upload.mockResolvedValueOnce(
      Response.json({ error: 'Gateway timeout' }, { status: 503 }),
    );
    const recovering = waiting(await writer.resume(inspected));
    const retrying = waiting(await writer.resume(recovering));
    const uploadedFirst = waiting(await writer.resume(retrying));
    const uploadedSecond = waiting(await writer.resume(uploadedFirst));
    const syncing = waiting(await writer.resume(uploadedSecond));
    const mapping = waiting(await writer.resume(syncing));
    const mappedFirst = waiting(await writer.resume(mapping));
    expect(mappedFirst.providerDocumentIds).toEqual([
      'citation-1',
      'citation-2',
    ]);
    expect(await writer.resume(mappedFirst)).toEqual({
      success: true,
      data: {
        kind: 'completed',
        indexedCount: 2,
        mappings: [chunk, second].map((current) => ({
          provider: 'llama-cloud',
          providerChunkId: `${current.citationId}:0`,
          providerFigureId: null,
          parseRunId: current.parseRunId,
          indexVersion: index.indexVersion,
          sourceVersionId: current.sourceVersionId,
          canonicalRegionIds: current.canonicalRegionIds,
        })),
      },
    });
  });
  it('should reject invalid resume handles and report checkpoint storage failures as retryable', async () => {
    const { params, handle, fetch } = fixture({});
    const cause = new Error('Private storage unavailable');
    expect(
      await createLlamaTextIndexWriter({
        ...params,
        writeCheckpoint: async () => {
          throw cause;
        },
      }).submit(input),
    ).toMatchObject({ success: false, error: { retryable: true }, cause });
    expect(
      await createLlamaTextIndexWriter({ ...params, apiKey: '' }).resume(
        handle,
      ),
    ).toMatchObject({ success: false, error: { retryable: false } });
    expect(
      await createLlamaTextIndexWriter(params).resume({
        ...handle,
        index: { ...index, indexVersion: 'foreign' },
      }),
    ).toMatchObject({ success: false, error: { retryable: false } });
    expect(
      await createLlamaTextIndexWriter({
        ...params,
        readCheckpoint: async () => {
          throw cause;
        },
      }).resume(handle),
    ).toMatchObject({ success: false, error: { retryable: true }, cause });
    expect(fetch.mock.calls).toEqual([]);
  });
  it('should reject incomplete configuration and noncanonical submissions without provider calls', async () => {
    const { params, fetch } = fixture({});
    for (const change of [
      { apiKey: '' },
      { indexId: '' },
      { sourceDirectoryId: '' },
      { ownerId: '' },
    ]) {
      expect(
        await createLlamaTextIndexWriter({ ...params, ...change }).submit(
          input,
        ),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    }
    const writer = createLlamaTextIndexWriter(params);
    for (const change of [
      { index: { ...index, indexVersion: 'foreign' } },
      { chunks: [{ ...chunk, contentAsRetrieved: '' }] },
      { chunks: [{ ...chunk, sourceVersionId: 'foreign' }] },
      { chunks: [{ ...chunk, parseRunId: 'foreign' }] },
      { chunks: [chunk, chunk] },
    ]) {
      expect(await writer.submit({ ...input, ...change })).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    }
    expect(await writer.submit({ ...input, chunks: [] })).toEqual({
      success: true,
      data: { kind: 'completed', mappings: [], indexedCount: 0 },
    });
    expect(fetch.mock.calls).toEqual([]);
  });
  it('should retain submit locally and inspect the remote index in one bounded continuation', async () => {
    const { writer, fetch, artifacts } = fixture({
      id: 'index',
      source_directory_id: 'directory',
    });

    const submitted = await writer.submit(input);
    expect(fetch.mock.calls).toEqual([]);
    const resumed = await writer.resume(waiting(submitted));

    expect(
      JSON.parse(
        new TextDecoder().decode(
          artifacts.get(waiting(resumed).checkpointAssetId),
        ),
      ),
    ).toMatchObject({ phase: 'upload', previousExport: null });

    expect(resumed).toMatchObject({
      success: true,
      data: { kind: 'waiting', providerDocumentIds: [] },
    });
    expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
      1,
    );
  });

  it('should return canonical mappings only for the complete matching provider chunk', async () => {
    const { writer, handle, fetch } = fixture({ results: [providerChunk] });

    const result = await writer.resume(handle);

    expect(result).toEqual({
      success: true,
      data: {
        kind: 'completed',
        indexedCount: 1,
        mappings: [
          {
            provider: 'llama-cloud',
            providerChunkId: 'file-1:0',
            providerFigureId: null,
            parseRunId: 'parse-1',
            indexVersion: 'v1',
            sourceVersionId: 'source-v1',
            canonicalRegionIds: ['region-1'],
          },
        ],
      },
    });
    expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
      1,
    );
    const request = new Request(...fetch.mock.calls[0]!);
    expect(await request.json()).toMatchObject({
      custom_filters: { anticaOwnerId: { operator: 'eq', value: 'owner' } },
    });
  });

  it.each([
    { ...providerChunk, content: 'Complete canonical' },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaOwnerId: 'other-owner' },
    },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaSourceVersionId: 'other-source' },
    },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaParseRunId: 'other-run' },
    },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaCitationId: 'other-citation' },
    },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaIndexVersion: 'other-index' },
    },
    {
      ...providerChunk,
      metadata: { ...metadata, anticaRegionIds: ['other-region'] },
    },
    {
      ...providerChunk,
      static_fields: { parsed_directory_file_id: '', chunk_index: 0 },
    },
    {
      ...providerChunk,
      static_fields: { parsed_directory_file_id: 'file-1', chunk_index: -1 },
    },
  ])(
    'should reject transformed text or mismatched canonical provider identity %#',
    async (item) => {
      const { writer, handle } = fixture({ results: [item] });

      const result = await writer.resume(handle);

      expect(result).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
      });
    },
  );

  it.each([
    {
      ...remoteIndex,
      metadata: { status: 'pending' },
      sync_in_progress: false,
      last_exported_at: 'new',
    },
    {
      ...remoteIndex,
      metadata: { status: 'ready' },
      sync_in_progress: true,
      last_exported_at: 'new',
    },
    { ...remoteIndex, metadata: { status: 'ready' }, sync_in_progress: false },
    {
      ...remoteIndex,
      metadata: { status: 'ready' },
      sync_in_progress: false,
      last_exported_at: null,
    },
  ])(
    'should keep an unfinished or stale remote export waiting %#',
    async (response) => {
      const { writer, handle, fetch } = fixture(response, 'wait');

      const result = await writer.resume(handle);

      expect(result).toMatchObject({
        success: true,
        data: { kind: 'waiting' },
      });
      expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
        1,
      );
    },
  );

  it.each(['failed', 'error'])(
    'should surface a %s export without declaring readiness',
    async (status) => {
      const { writer, handle } = fixture(
        { ...remoteIndex, metadata: { status } },
        'wait',
      );

      const result = await writer.resume(handle);

      expect(result).toMatchObject({
        success: false,
        error: { retryable: false },
      });
    },
  );

  it('should advance a ready export to mapping without retrieving in the same continuation', async () => {
    const { writer, handle, fetch, artifacts } = fixture(
      {
        ...remoteIndex,
        metadata: { status: 'ready' },
        sync_in_progress: false,
        last_exported_at: 'new',
      },
      'wait',
    );

    const result = waiting(await writer.resume(handle));

    expect(
      JSON.parse(
        new TextDecoder().decode(artifacts.get(result.checkpointAssetId)),
      ),
    ).toMatchObject({ phase: 'map' });
    expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
      1,
    );
  });

  it('should reject a checkpoint resumed by a different owner before network access', async () => {
    const { params, handle, fetch } = fixture({ results: [providerChunk] });

    const result = await createLlamaTextIndexWriter({
      ...params,
      ownerId: 'other-owner',
    }).resume(handle);

    expect(result).toMatchObject({
      success: false,
      error: { retryable: false },
    });
    expect(fetch.mock.calls).toEqual([]);
  });

  it('should upload exact canonical bytes and retain verified document identity', async () => {
    const { params, artifacts } = fixture({}, 'upload');
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (url === 'data:,') {
        return new Response();
      }
      const form = await new Request(url, init).formData();
      const file = form.get('upload_file');
      expect(file).toBeInstanceOf(File);
      if (!(file instanceof File)) {
        throw new Error('Missing upload file');
      }
      expect(await file.text()).toBe(chunk.contentAsRetrieved);

      return Response.json({
        id: 'file-1',
        directory_id: 'directory',
        unique_id: form.get('unique_id'),
        metadata: JSON.parse(form.get('metadata') as string),
      });
    });
    const writer = createLlamaTextIndexWriter({ ...params, fetch });
    const inspected = waiting(
      await createLlamaTextIndexWriter({
        ...params,
        fetch: async () => Response.json(remoteIndex),
      }).resume(waiting(await writer.submit(input))),
    );

    const result = waiting(await writer.resume(inspected));

    expect(result.providerDocumentIds).toEqual(['file-1']);
    expect(
      JSON.parse(
        new TextDecoder().decode(artifacts.get(result.checkpointAssetId)),
      ),
    ).toMatchObject({ phase: 'sync' });
    expect(fetch.mock.calls.filter(([url]) => url !== 'data:,')).toHaveLength(
      1,
    );
  });
});
