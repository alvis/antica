import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { describe, expect, inject, vi } from 'vitest';

import {
  createKnowledgeService,
  createSourceService,
  createSourceIngestionHandler,
} from '@antica/application/server';
import {
  collectorUserId,
  createDatabase,
  createTransactionPort,
  readKnowledgeConfiguration,
} from '@antica/platform';

import { createHttpTest } from '../fixtures/http/test.js';

import { knowledgeInput } from '../fixtures/knowledge.js';
import { createLocalSettings } from '../fixtures/runtime.js';
import { sourceInput } from '../fixtures/source.js';
import { createTextProvider } from '../retrieval.js';

import { createKnowledgeRoutes } from './knowledge.js';

import type {
  OperationResult,
  ParsedSourcePack,
  DurableSourceParsingPort,
  TextIndexWriterPort,
  SourceRepository,
  SourceParsingPort,
  TransactionPort,
  UnitOfWork,
} from '@antica/application/ports';

import type { HttpFixture } from '../fixtures/http.js';

import type { ApiEnv } from '../http.js';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/knowledge']!);
const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Selected source page projection', () => {
  it('should persist external writer mappings for public citation resolution and replay', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const configuration = value(
      readKnowledgeConfiguration({
        ANTICA_PARSING_DRIVER: 'local',
        ANTICA_TEXT_SEARCH_DRIVER: 'llama',
        LLAMA_CLOUD_API_KEY: 'synthetic-test-key',
        LLAMA_CLOUD_INDEX_ID: 'test-index',
        LLAMA_CLOUD_SOURCE_DIRECTORY_ID: 'test-directory',
        LLAMA_TEXT_EMBEDDING_MODEL_ID: 'embedding',
        LLAMA_TEXT_DIMENSIONS: '8',
        ANTICA_TEXT_INDEX_VERSION: randomUUID(),
      }),
    );
    const selected = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revised = pack(selected.jobId, [0], 'external-mapping');
    const fileId = randomUUID();
    const indexSource = vi.fn<TextIndexWriterPort['indexSource']>(
      async (request) => ({
        success: true,
        data: {
          indexedCount: request.chunks.length,
          mappings: request.chunks.map((chunk, ordinal) => ({
            provider: 'llama-cloud',
            providerChunkId: `${fileId}:${ordinal}`,
            providerFigureId: null,
            parseRunId: chunk.parseRunId,
            indexVersion: request.index.indexVersion,
            sourceVersionId: request.sourceVersionId,
            canonicalRegionIds: chunk.canonicalRegionIds,
          })),
        },
      }),
    );
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: {
        parse: async () => ({ success: true, data: revised }),
      },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: configuration.textIndex,
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: true,
    });
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Response.json({
          results: [
            {
              metadata: {
                anticaOwnerId: collectorUserId,
                anticaIndexVersion: configuration.textIndex.indexVersion,
              },
              content: revised.pages[0]!.rawText,
              static_fields: {
                parsed_directory_file_id: fileId,
                chunk_index: 0,
              },
            },
          ],
        }),
      ),
    );
    const provider = createTextProvider(
      { ...createLocalSettings(), knowledge: configuration },
      fixture.runtime,
    );
    const resolved = value(
      await provider.snapshot('indexed page', configuration.textIndex),
    );
    expect(resolved.text).toEqual([
      expect.objectContaining({
        contentAsRetrieved: revised.pages[0]!.rawText,
      }),
    ]);
    expect(resolved.citations).toEqual([
      expect.objectContaining({
        locator: expect.objectContaining({
          sourceVersionId: accepted.sourceVersionId,
          pageId: revised.pages[0]!.id,
          canonicalViewId: revised.pages[0]!.view.id,
          regionId: revised.regions[0]!.id,
        }),
      }),
    ]);
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: true,
    });
    expect(
      value(await provider.snapshot('indexed page', configuration.textIndex)),
    ).toMatchObject({
      text: resolved.text,
      citations: resolved.citations,
      index: configuration.textIndex,
    });
    expect(indexSource).toHaveBeenCalledTimes(1);
  });

  it('should reject a malformed persisted projection base without replaying external work', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const selected = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: true,
      data: pack(selected.jobId, [0], 'corrupt-base'),
    }));
    const indexSource = vi.fn<TextIndexWriterPort['indexSource']>(async () => ({
      success: false,
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'Synthetic indexing interruption',
        retryable: true,
      },
    }));
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { parse },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          },
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      value(
        await fixture.runtime.transaction.run(collectorUserId, async (unit) => {
          const saved = await unit.jobs.getStep(selected.jobId, 'parse:base');
          if (!saved) {
            throw new Error('Expected persisted projection checkpoint');
          }

          return {
            success: true,
            data: await unit.jobs.updateStep(
              {
                ...saved,
                result: {
                  pages: [{ pageId: original.pages[0]!.id, parseRunId: 7 }],
                  textIndexStatus: 'ready',
                  imageIndexStatus: 'ready',
                },
              },
              saved.revision,
            ),
          };
        }),
      ),
    ).toBe(true);
    const before = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    const jobBefore = value(
      await fixture.runtime.transaction.run(collectorUserId, async (unit) => ({
        success: true,
        data: await unit.jobs.get(selected.jobId),
      })),
    );
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(indexSource).toHaveBeenCalledTimes(1);
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toEqual(before);
    expect(
      value(
        await fixture.runtime.transaction.run(
          collectorUserId,
          async (unit) => ({
            success: true,
            data: await unit.jobs.get(selected.jobId),
          }),
        ),
      ),
    ).toEqual(jobBefore);
  });

  it('should roll back stale completion mappings when a newer public reprocess wins', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const command = {
      mode: 'reprocess' as const,
      sourceVersionId: accepted.sourceVersionId,
      pageIds: [original.pages[0]!.id],
    };
    const older = value(
      await sources.submit(collectorUserId, {
        ...command,
        requestKey: randomUUID(),
      }),
    );
    const newer = value(
      await sources.submit(collectorUserId, {
        ...command,
        requestKey: randomUUID(),
      }),
    );
    const oldPack = pack(older.jobId, [0], 'completion-loser');
    const revised = pack(newer.jobId, [0], 'completion-winner');
    const index = {
      embeddingModelId: 'test',
      dimensions: 3,
      indexVersion: randomUUID(),
    };
    const mapping = {
      provider: 'llama-cloud',
      providerChunkId: randomUUID(),
      providerFigureId: null,
      parseRunId: older.jobId,
      indexVersion: index.indexVersion,
      sourceVersionId: accepted.sourceVersionId,
      canonicalRegionIds: oldPack.pages[0]!.regionIds,
    };
    const gate = createVersionReadBarrier(
      fixture.runtime.transaction,
      accepted.sourceVersionId,
    );
    const indexSource = vi.fn<TextIndexWriterPort['indexSource']>(async () => ({
      success: true,
      data: { indexedCount: 1, mappings: [mapping] },
    }));
    const handler = createSourceIngestionHandler({
      transaction: gate.transaction,
      parser: {
        parse: async () => ({ success: true, data: oldPack }),
      },
      clock,
      ids,
      indexing: {
        text: { kind: 'external', index, writer: { indexSource } },
        image: {
          kind: 'external',
          writer: {
            index: async () => {
              gate.arm();

              return { success: true, data: { indexedCount: 0 } };
            },
          },
        },
      },
    });
    const result = await gate.race(
      async () => handler(collectorUserId, older.jobId),
      async () => {
        value(
          await createSourceIngestionHandler({
            transaction: fixture.runtime.transaction,
            parser: {
              parse: async () => ({ success: true, data: revised }),
            },
            clock,
            ids,
          })(collectorUserId, newer.jobId),
        );
      },
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(indexSource).toHaveBeenCalledTimes(1);
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: [revised.pages[0], original.pages[1]] },
      regions: expect.arrayContaining([
        ...revised.regions,
        original.regions[1],
      ]),
      version: {
        activeParseRunId: newer.jobId,
        status: 'partial',
        textIndexStatus: 'partial',
        imageIndexStatus: 'partial',
      },
    });
    expect(
      value(
        await fixture.runtime.transaction.run(
          collectorUserId,
          async (unit) => ({
            success: true,
            data: {
              older: await unit.jobs.get(older.jobId),
              newer: await unit.jobs.get(newer.jobId),
            },
          }),
        ),
      ),
    ).toMatchObject({
      older: { state: { kind: 'running', stage: 'indexing' } },
      newer: { state: { kind: 'partial' } },
    });
    expect(
      (await fixture.runtime.readers.readTextEntries())
        .filter(
          (entry) =>
            entry.citation.locator.sourceVersionId === accepted.sourceVersionId,
        )
        .map((entry) => entry.contentAsRetrieved)
        .sort(),
    ).toEqual([revised.pages[0]!.rawText, original.pages[1]!.rawText].sort());
    const persisted = await fixture.runtime.database.db.$queryRaw`
      select mapping.id from source_chunk_mappings mapping
      join source_versions version on version.id = mapping.source_version_id
      where version.owner_id = ${collectorUserId}
        and mapping.provider = ${mapping.provider}
        and mapping.provider_chunk_id = ${mapping.providerChunkId}
    `;
    expect(persisted).toHaveLength(0);
  });

  it('should reject stale projection capture before parsing or saving a base', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const command = {
      mode: 'reprocess' as const,
      sourceVersionId: accepted.sourceVersionId,
      pageIds: [original.pages[0]!.id],
    };
    const older = value(
      await sources.submit(collectorUserId, {
        ...command,
        requestKey: randomUUID(),
      }),
    );
    const newer = value(
      await sources.submit(collectorUserId, {
        ...command,
        requestKey: randomUUID(),
      }),
    );
    const revised = pack(newer.jobId, [0], 'capture-winner');
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: true,
      data: pack(older.jobId, [0], 'capture-loser'),
    }));
    const gate = createVersionReadBarrier(
      fixture.runtime.transaction,
      accepted.sourceVersionId,
    );
    gate.arm();
    const handler = createSourceIngestionHandler({
      transaction: gate.transaction,
      parser: { parse },
      clock,
      ids,
    });
    const result = await gate.race(
      async () => handler(collectorUserId, older.jobId),
      async () => {
        value(
          await createSourceIngestionHandler({
            transaction: fixture.runtime.transaction,
            parser: {
              parse: async () => ({ success: true, data: revised }),
            },
            clock,
            ids,
          })(collectorUserId, newer.jobId),
        );
      },
    );
    expect(result).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(parse).not.toHaveBeenCalled();
    expect(
      value(
        await fixture.runtime.transaction.run(
          collectorUserId,
          async (unit) => ({
            success: true,
            data: {
              base: await unit.jobs.getStep(older.jobId, 'parse:base'),
              job: await unit.jobs.get(older.jobId),
            },
          }),
        ),
      ),
    ).toMatchObject({ base: null, job: { state: { kind: 'queued' } } });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: [revised.pages[0], original.pages[1]] },
      regions: expect.arrayContaining([
        ...revised.regions,
        original.regions[1],
      ]),
      version: {
        activeParseRunId: newer.jobId,
        status: 'ready',
        textIndexStatus: 'ready',
        imageIndexStatus: 'ready',
      },
    });
  });

  it('should keep a retained unparsed page visible and prevent whole-version readiness after selected reprocessing', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const unparsed = original.pages[1]!;
    await fixture.runtime.database.db.$executeRaw`
      delete from source_page_parses
      where parse_run_id = ${original.parseRunId}::uuid and page_id = ${unparsed.id}::uuid
    `;
    const selected = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revised = pack(selected.jobId, [0], 'complete-first');
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: true,
      data: revised,
    }));
    const indexSource = vi
      .fn<TextIndexWriterPort['indexSource']>(async () => ({
        success: true,
        data: { indexedCount: 1, mappings: [] },
      }))
      .mockResolvedValueOnce({
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Synthetic replay interruption',
          retryable: true,
        },
      });
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { parse },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          },
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: true,
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(indexSource).toHaveBeenCalledTimes(2);
    const detail = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    expect(detail.version).toMatchObject({
      status: 'partial',
      textIndexStatus: 'partial',
      imageIndexStatus: 'partial',
    });
    expect(detail.pages.items).toEqual([
      revised.pages[0],
      {
        ...unparsed,
        rawText: '',
        searchText: '',
        quality: 'needs_review',
        regionIds: [],
      },
    ]);
  });

  it('should replay a selected parse checkpoint without recapturing its processing index statuses', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const selected = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revised = pack(selected.jobId, [0], 'checkpoint');
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: true,
      data: revised,
    }));
    const indexSource = vi
      .fn<TextIndexWriterPort['indexSource']>(async () => ({
        success: true,
        data: { indexedCount: 1, mappings: [] },
      }))
      .mockResolvedValueOnce({
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Synthetic indexing outage',
          retryable: true,
        },
      });
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { parse },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          },
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: [revised.pages[0], original.pages[1]] },
      version: { status: 'processing', textIndexStatus: 'processing' },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: true,
    });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: [revised.pages[0], original.pages[1]] },
      version: {
        status: 'ready',
        textIndexStatus: 'ready',
        imageIndexStatus: 'ready',
      },
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(indexSource).toHaveBeenCalledTimes(2);
  });

  it('should resolve retained B through the configured provider factory and reject the replaced A mapping', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const configuration = value(
      readKnowledgeConfiguration({
        ANTICA_PARSING_DRIVER: 'local',
        ANTICA_TEXT_SEARCH_DRIVER: 'llama',
        LLAMA_CLOUD_API_KEY: 'synthetic-test-key',
        LLAMA_CLOUD_INDEX_ID: 'test-index',
        LLAMA_CLOUD_SOURCE_DIRECTORY_ID: 'test-directory',
        LLAMA_TEXT_EMBEDDING_MODEL_ID: 'embedding',
        LLAMA_TEXT_DIMENSIONS: '8',
        ANTICA_TEXT_INDEX_VERSION: randomUUID(),
      }),
    );
    value(
      await fixture.runtime.transaction.run(collectorUserId, async (unit) => {
        await unit.sources.addProviderChunkMappings(
          configuration.textIndex,
          original.regions.map((region, index) => ({
            provider: 'llama-cloud',
            providerChunkId: `fixture-file:${index}`,
            providerFigureId: null,
            parseRunId: original.parseRunId,
            indexVersion: configuration.textIndex.indexVersion,
            sourceVersionId: accepted.sourceVersionId,
            canonicalRegionIds: [region.id],
          })),
        );

        return { success: true, data: undefined };
      }),
    );
    const a = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revised = pack(a.jobId, [0], 'mapped');
    value(
      await createSourceIngestionHandler({
        transaction: fixture.runtime.transaction,
        parser: {
          parse: async () => ({ success: true, data: revised }),
        },
        clock,
        ids,
      })(collectorUserId, a.jobId),
    );
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        results: [
          {
            metadata: {
              anticaOwnerId: collectorUserId,
              anticaIndexVersion: configuration.textIndex.indexVersion,
            },
            content: original.pages[1]!.rawText,
            static_fields: {
              parsed_directory_file_id: 'fixture-file',
              chunk_index: 1,
            },
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', transport);
    const provider = createTextProvider(
      { ...createLocalSettings(), knowledge: configuration },
      fixture.runtime,
    );
    const snapshot = value(
      await provider.snapshot('retained page', configuration.textIndex),
    );
    expect(snapshot.text).toEqual([
      expect.objectContaining({
        contentAsRetrieved: original.pages[1]!.rawText,
      }),
    ]);
    expect(snapshot.citations).toEqual([
      expect.objectContaining({
        locator: expect.objectContaining({
          sourceVersionId: accepted.sourceVersionId,
          pageId: original.pages[1]!.id,
          regionId: original.regions[1]!.id,
        }),
      }),
    ]);
    transport.mockResolvedValueOnce(
      Response.json({
        results: [
          {
            metadata: {
              anticaOwnerId: collectorUserId,
              anticaIndexVersion: configuration.textIndex.indexVersion,
            },
            content: original.pages[0]!.rawText,
            static_fields: {
              parsed_directory_file_id: 'fixture-file',
              chunk_index: 0,
            },
          },
        ],
      }),
    );
    expect(
      await provider.snapshot('stale page', configuration.textIndex),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('should reject a late superseded public reprocess without publishing its pages or regions', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const older = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const late = pack(older.jobId, [0], 'late');
    const publications: ParsedSourcePack[] = [];
    const parse = vi.fn<SourceParsingPort['parse']>(async () => {
      const newer = value(
        await sources.submit(collectorUserId, {
          mode: 'reprocess',
          requestKey: randomUUID(),
          sourceVersionId: accepted.sourceVersionId,
          pageIds: [original.pages[1]!.id],
        }),
      );
      const published = pack(newer.jobId, [1], 'newer');
      value(
        await createSourceIngestionHandler({
          transaction: fixture.runtime.transaction,
          parser: {
            parse: async () => ({ success: true, data: published }),
          },
          clock,
          ids,
        })(collectorUserId, newer.jobId),
      );
      publications.push(published);

      return { success: true, data: late };
    });
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { parse },
      clock,
      ids,
    });
    expect(await handler(collectorUserId, older.jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    const published = publications[0]!;
    const detail = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    expect(detail.version.activeParseRunId).toBe(published.parseRunId);
    expect(detail.pages.items).toEqual([original.pages[0], published.pages[0]]);
    expect(detail.regions.map(({ id }) => id).sort()).toEqual(
      [original.regions[0]!.id, published.regions[0]!.id].sort(),
    );
    expect(
      (await fixture.runtime.readers.readTextEntries())
        .filter(
          (entry) =>
            entry.citation.locator.sourceVersionId === accepted.sourceVersionId,
        )
        .map((entry) => entry.sourceRegionId)
        .sort(),
    ).toEqual([original.regions[0]!.id, published.regions[0]!.id].sort());
    expect(await handler(collectorUserId, older.jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toEqual(detail);
  });

  it('should retain the immutable base through pending parsing, failure and index-checkpoint replay', async ({
    fixture,
  }) => {
    const { sources, accepted, original, pack } =
      await createProjection(fixture);
    const selected = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const unavailable = {
      success: false as const,
      error: {
        code: 'PROVIDER_UNAVAILABLE' as const,
        message: 'Synthetic outage',
        retryable: true,
      },
    };
    const submit = vi.fn<DurableSourceParsingPort['submit']>(
      async (request) => ({
        success: true,
        data: {
          ...request,
          kind: 'waiting',
          provider: 'fixture',
          providerJobId: randomUUID(),
        },
      }),
    );
    const resume = vi.fn<DurableSourceParsingPort['resume']>(
      async () => unavailable,
    );
    const indexSource = vi
      .fn<TextIndexWriterPort['indexSource']>(async () => ({
        success: true,
        data: { indexedCount: 1, mappings: [] },
      }))
      .mockResolvedValueOnce(unavailable);
    const handler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { submit, resume },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          },
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject({
      success: true,
    });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: original.pages },
      version: { status: 'processing' },
    });
    expect(
      (await fixture.runtime.readers.readTextEntries())
        .filter(
          (entry) =>
            entry.citation.locator.sourceVersionId === accepted.sourceVersionId,
        )
        .map((entry) => entry.sourceRegionId)
        .sort(),
    ).toEqual(original.regions.map(({ id }) => id).sort());
    expect(await handler(collectorUserId, selected.jobId)).toMatchObject(
      unavailable,
    );
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: original.pages },
      version: { status: 'failed' },
    });
    const retry = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revised = pack(retry.jobId, [0], 'retried');
    const parse = vi.fn<SourceParsingPort['parse']>(async () => ({
      success: true,
      data: revised,
    }));
    const retryHandler = createSourceIngestionHandler({
      transaction: fixture.runtime.transaction,
      parser: { parse },
      clock,
      ids,
      indexing: {
        text: {
          kind: 'external',
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          },
          writer: { indexSource },
        },
        image: { kind: 'local' },
      },
    });
    expect(await retryHandler(collectorUserId, retry.jobId)).toMatchObject(
      unavailable,
    );
    const checkpointed = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    expect(checkpointed.pages.items).toEqual([
      revised.pages[0],
      original.pages[1],
    ]);
    expect(checkpointed.version.status).not.toBe('ready');
    expect(await retryHandler(collectorUserId, retry.jobId)).toMatchObject({
      success: true,
    });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ),
    ).toMatchObject({
      pages: { items: [revised.pages[0], original.pages[1]] },
      version: {
        status: 'partial',
        textIndexStatus: 'partial',
        imageIndexStatus: 'partial',
      },
    });
    expect(parse).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(indexSource).toHaveBeenCalledTimes(2);
  });

  it('should preserve two-page readers and historic citations through successive and empty selected-page reprocessing', async ({
    fixture,
  }) => {
    const context = await createProjection(fixture);
    const { sources, knowledge, accepted, original, pack } = context;
    const initial = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    const draft = value(
      await knowledge.get(collectorUserId, initial.knowledgeDraftIds[0]!, 1),
    );
    const retainedB = original.pages[1]!;
    const a = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const revisedA = pack(a.jobId, [0], 'revised');
    expect(
      await createSourceIngestionHandler({
        transaction: fixture.runtime.transaction,
        parser: {
          parse: async () => ({ success: true, data: revisedA }),
        },
        clock,
        ids,
      })(collectorUserId, a.jobId),
    ).toMatchObject({ success: true });
    const afterA = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    expect(afterA.pages.items).toEqual([revisedA.pages[0], retainedB]);
    expect(afterA.regions).toEqual(
      expect.arrayContaining([...revisedA.regions, original.regions[1]]),
    );
    expect(afterA.regions.map(({ id }) => id).sort()).toEqual(
      [revisedA.regions[0]!.id, original.regions[1]!.id].sort(),
    );
    expect(
      value(
        await sources.get({
          ownerId: collectorUserId,
          id: accepted.sourceId,
          versionId: accepted.sourceVersionId,
          pageId: retainedB.id,
        }),
      ).pages.items,
    ).toEqual([retainedB]);
    expect(
      (await fixture.runtime.readers.readTextEntries())
        .filter(
          (entry) =>
            entry.citation.locator.sourceVersionId === accepted.sourceVersionId,
        )
        .map((entry) => entry.contentAsRetrieved)
        .sort(),
    ).toEqual([revisedA.pages[0]!.rawText, retainedB.rawText].sort());
    const b = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [retainedB.id],
      }),
    );
    const revisedB = pack(b.jobId, [1], 'successive');
    expect(
      await createSourceIngestionHandler({
        transaction: fixture.runtime.transaction,
        parser: {
          parse: async () => ({ success: true, data: revisedB }),
        },
        clock,
        ids,
      })(collectorUserId, b.jobId),
    ).toMatchObject({ success: true });
    expect(
      value(
        await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
      ).pages.items,
    ).toEqual([revisedA.pages[0], revisedB.pages[0]]);
    const empty = value(
      await sources.submit(collectorUserId, {
        mode: 'reprocess',
        requestKey: randomUUID(),
        sourceVersionId: accepted.sourceVersionId,
        pageIds: [original.pages[0]!.id],
      }),
    );
    const emptyA = pack(empty.jobId, [0], 'empty');
    expect(
      await createSourceIngestionHandler({
        transaction: fixture.runtime.transaction,
        parser: {
          parse: async () => ({ success: true, data: emptyA }),
        },
        clock,
        ids,
      })(collectorUserId, empty.jobId),
    ).toMatchObject({ success: true });
    const afterEmpty = value(
      await sources.get({ ownerId: collectorUserId, id: accepted.sourceId }),
    );
    expect(afterEmpty.pages.items).toEqual([
      emptyA.pages[0],
      revisedB.pages[0],
    ]);
    expect(afterEmpty.regions.map(({ id }) => id)).toEqual([
      revisedB.regions[0]!.id,
    ]);
    expect(
      (await fixture.runtime.readers.readTextEntries())
        .filter(
          (entry) =>
            entry.citation.locator.sourceVersionId === accepted.sourceVersionId,
        )
        .map((entry) => entry.sourceRegionId),
    ).toEqual([revisedB.regions[0]!.id]);
    expect(afterEmpty.knowledgeDraftIds).toEqual(initial.knowledgeDraftIds);
    expect(
      value(await knowledge.get(collectorUserId, draft.entry.id, 1)),
    ).toEqual(draft);
    expect(
      value(
        await fixture.runtime.transaction.run(
          collectorUserId,
          async (unit) => ({
            success: true,
            data: await Promise.all(
              draft.citations.map(async (citation) =>
                unit.sources.getCitation(citation.id),
              ),
            ),
          }),
        ),
      ),
    ).toEqual(draft.citations);
  });
});

describe('Persistent knowledge revisions', () => {
  it('should retain pinned legacy method responses and missing revision failures without discovery', async ({
    fixture,
  }) => {
    const ownerId = randomUUID();
    const transaction = createTransactionPort(fixture.runtime.database.db);
    const knowledge = createKnowledgeService(transaction, clock, ids);
    const draft = value(await knowledge.create(ownerId, knowledgeInput()));
    const app = new Hono<ApiEnv>();
    app.use('*', async (context, next) => {
      context.set('ownerId', ownerId);
      await next();
    });
    app.route(
      '/v1',
      createKnowledgeRoutes(
        createSourceService({ transaction, clock, ids }),
        knowledge,
      ),
    );
    const pinned = await app.request(
      `/v1/knowledge/${draft.entry.id}?methodVersionId=${draft.methodVersions[0]!.id}`,
    );
    expect(pinned.status).toBe(200);
    expect(await pinned.json()).toEqual(draft);
    const persisted = value(
      await knowledge.getV2(ownerId, draft.entry.id, {
        view: 'revision',
        revision: 1,
      }),
    );
    expect(pinned.headers.get('etag')).toBe(`"1-${persisted.contentHash}"`);
    const missing = await app.request(
      `/v1/knowledge/${randomUUID()}?methodVersionId=${randomUUID()}`,
    );
    expect(missing.status).toBe(404);
    expect(missing.headers.get('etag')).toBeNull();
    expect(await missing.json()).toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await knowledge.getV2(ownerId, draft.entry.id, {
        view: 'revision',
        revision: 999,
      }),
    ).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('should retain the original draft and method when the collector saves a new revision', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    const input = knowledgeInput();
    const draft = value(await service.create(ownerId, input));
    const method = draft.methodVersions[0]!;
    const saved = value(
      await service.update(ownerId, draft.entry.id, {
        ...input,
        requestKey: randomUUID(),
        expectedRevision: 1,
        status: 'saved',
        content: { ...input.content, titleZhHant: '收藏家修訂' },
        methodWrites: [
          {
            methodId: method.methodId,
            expectedVersionId: method.id,
            definition: { ...method.definition, titleZhHant: '修訂檢查' },
          },
        ],
      }),
    );
    expect(saved.entry).toMatchObject({
      revision: 2,
      status: 'saved',
      savedBy: 'collector',
    });
    expect(saved.methodVersions[0]).toMatchObject({
      revision: 2,
      definition: { titleZhHant: '修訂檢查' },
    });
    expect(value(await service.get(ownerId, draft.entry.id, 1))).toMatchObject({
      entry: {
        status: 'draft',
        revision: 1,
        content: { titleZhHant: input.content.titleZhHant },
      },
      methodVersions: [{ id: method.id, revision: 1 }],
    });
    expect(
      await service.update(ownerId, draft.entry.id, {
        ...input,
        requestKey: randomUUID(),
        expectedRevision: 1,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(await service.get(randomUUID(), draft.entry.id)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('should replay an identical create request and reject a changed request without creating another entry', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    const input = knowledgeInput();
    const first = value(await service.create(ownerId, input));
    expect(value(await service.create(ownerId, input))).toEqual(first);
    expect(
      await service.create(ownerId, { ...input, status: 'saved' }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      value(await service.list(ownerId, {})).items.map((item) => item.id),
    ).toEqual([first.entry.id]);
  });

  it('should roll back an entry whose linked method is unavailable', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    const input = { ...knowledgeInput(), linkedMethodIds: [randomUUID()] };
    expect(await service.create(ownerId, input)).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE' },
    });
    expect(value(await service.list(ownerId, {})).items).toEqual([]);
    expect(
      await service.create(ownerId, { ...input, linkedMethodIds: [] }),
    ).toMatchObject({ success: true });
  });

  it('should keep missing support visibly marked and reject invented citation identifiers', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    const input = knowledgeInput();
    const saved = value(
      await service.create(ownerId, { ...input, status: 'saved' }),
    );
    expect(saved.entry.content.summary).toMatchObject({
      support: 'needs_source',
      citationIds: [],
    });
    expect(
      await service.create(ownerId, {
        ...input,
        requestKey: randomUUID(),
        content: {
          ...input.content,
          summary: {
            textZhHant: '無依據主張',
            support: 'cited',
            citationIds: [randomUUID()],
          },
        },
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });
});

describe('Explicit source intake', () => {
  it('should register ready intake pages only on command and persist one queued ingestion job on replay', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService({
      transaction,
      clock,
      ids,
    });
    const command = await sourceInput(transaction, ownerId);
    expect(
      value(
        await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.outbox.pending(20),
        })),
      ),
    ).toEqual([]);
    const accepted = value(await service.submit(ownerId, command));
    expect(value(await service.submit(ownerId, command))).toEqual(accepted);
    const detail = value(await service.get({ ownerId, id: accepted.sourceId }));
    expect(detail).toMatchObject({
      source: { metadata: { authorStatus: 'unknown', contributors: [] } },
      version: { id: accepted.sourceVersionId, status: 'registered' },
      processingJobId: accepted.jobId,
    });
    const outbox = value(
      await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.outbox.pending(20),
      })),
    );
    expect(outbox.map((item) => item.name)).toEqual(['sourceIngestion']);
    expect(
      await service.submit(ownerId, {
        ...command,
        registration: {
          ...command.registration,
          metadata: {
            ...command.registration.metadata,
            title: 'Changed title',
          },
        },
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await service.get({ ownerId: randomUUID(), id: accepted.sourceId }),
    ).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('should reject unfinished uploads and assets belonging to another intake', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService({
      transaction,
      clock,
      ids,
    });
    const unfinished = await sourceInput(transaction, ownerId, {
      ready: false,
    });
    expect(await service.submit(ownerId, unfinished)).toMatchObject({
      success: false,
      error: { code: 'UPLOAD_INCOMPLETE' },
    });
    const ready = await sourceInput(transaction, ownerId);
    expect(
      await service.submit(ownerId, {
        ...ready,
        registration: { ...ready.registration, intakeKey: randomUUID() },
      }),
    ).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
    expect(
      value(
        await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.outbox.pending(20),
        })),
      ),
    ).toEqual([]);
  });

  it('should retain a failed parsing job for an explicit retry without publishing knowledge', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService({
      transaction,
      clock,
      ids,
    });
    const parser: SourceParsingPort = {
      parse: async () => ({
        success: false,
        error: {
          code: 'PROVIDER_UNAVAILABLE',
          message: 'Parser unavailable',
          retryable: true,
        },
      }),
    };
    const accepted = value(
      await service.submit(ownerId, await sourceInput(transaction, ownerId)),
    );
    expect(
      await createSourceIngestionHandler({
        transaction,
        parser,
        clock,
        ids,
      })(ownerId, accepted.jobId),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      value(
        await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.jobs.get(accepted.jobId),
        })),
      ),
    ).toMatchObject({
      state: { kind: 'failed', error: { code: 'PROVIDER_UNAVAILABLE' } },
    });
    expect(
      value(await service.get({ ownerId, id: accepted.sourceId }))
        .knowledgeDraftIds,
    ).toEqual([]);
  });

  it.for(['local', 'text', 'image', 'durable', 'review'] as const)(
    'should expose parsed source text as a draft and retain its page locator with %s indexing',
    async (indexing, { fixture }) => {
      const database = fixture.runtime.database;
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      const sources = createSourceService({
        transaction,
        clock,
        ids,
      });
      const knowledge = createKnowledgeService(transaction, clock, ids);
      const original = await sourceInput(transaction, ownerId);
      const presentation = {
        rotationQuarterTurns: 1 as const,
        crop: {
          kind: 'rect' as const,
          x: 0.1,
          y: 0.2,
          width: 0.7,
          height: 0.6,
        },
      };
      const command = {
        ...original,
        registration: {
          ...original.registration,
          assets: original.registration.assets.map((asset) => ({
            ...asset,
            presentation,
          })),
        },
      };
      const accepted = value(await sources.submit(ownerId, command));
      const originalAssetId = command.registration.assets[0]!.assetId;
      const view = {
        id: randomUUID(),
        originalAssetId,
        derivativeId: randomUUID(),
        width: 100,
        height: 200,
        originalCoordinateSpace: 'image_pixels' as const,
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1] as const,
      };
      value(
        await transaction.run(ownerId, async (unit) => {
          await unit.media.addDerivative({
            id: view.derivativeId,
            originalAssetId,
            parentDerivativeId: null,
            kind: 'canonical',
            storageKey: `tests/${view.derivativeId}`,
            mimeType: 'image/jpeg',
            byteLength: 12,
            sha256: 'ab'.repeat(32),
            region: null,
            transformToOriginal: view.transformToOriginal,
          });
          await unit.media.addCanonicalView(view);

          return { success: true, data: undefined };
        }),
      );
      const pageId = randomUUID();
      const referenceImageId = randomUUID();
      const parser: SourceParsingPort = {
        parse: async (input) => ({
          success: true,
          data: {
            sourceVersionId: input.sourceVersionId,
            parseRunId: input.parseRunId,
            rawOutputAssetId: originalAssetId,
            pages: [
              {
                id: pageId,
                sourceVersionId: input.sourceVersionId,
                pageIndex: 0,
                printedPageLabel: '十二',
                originalAssetId,
                pdfPageIndex: null,
                view,
                presentation: null,
                rawText: '書頁原文：釉面觀察。',
                searchText: '釉面觀察',
                quality: indexing === 'review' ? 'needs_review' : 'usable',
                regionIds: [],
              },
            ],
            regions: [],
            images: [
              {
                id: referenceImageId,
                sourceVersionId: input.sourceVersionId,
                locator: {
                  kind: 'page',
                  sourceId: accepted.sourceId,
                  sourceVersionId: input.sourceVersionId,
                  pageId,
                  pageIndex: 0,
                  printedPageLabel: '十二',
                  canonicalViewId: view.id,
                  regionId: null,
                  region: null,
                  textRange: null,
                },
                figureRegionId: null,
                storedDerivativeId: null,
                externalImageUrl: null,
                originalCaption: null,
                generatedDescriptionZhHant: null,
                descriptionJobId: null,
                captionAssociation: 'none',
              },
            ],
            warnings: [],
          },
        }),
      };
      const handler = createSourceIngestionHandler({
        transaction,
        parser:
          indexing === 'durable'
            ? {
                submit: async (request) => ({
                  success: true,
                  data: {
                    kind: 'completed',
                    pack: value(
                      await parser.parse({
                        sourceVersionId: request.sourceVersionId,
                        parseRunId: request.parseRunId,
                        originalAssetIds: [request.originalAssetId],
                      }),
                    ),
                  },
                }),
                resume: async () => {
                  throw new Error('No pending parse');
                },
              }
            : parser,
        clock,
        ids,
        indexing: {
          text:
            indexing === 'text'
              ? {
                  kind: 'external',
                  index: {
                    embeddingModelId: 'test',
                    dimensions: 3,
                    indexVersion: randomUUID(),
                  },
                  writer: {
                    indexSource: async () => ({
                      success: true,
                      data: { indexedCount: 0, mappings: [] },
                    }),
                  },
                }
              : { kind: 'local' },
          image:
            indexing === 'image'
              ? {
                  kind: 'external',
                  writer: {
                    index: async () => ({
                      success: true,
                      data: { indexedCount: 0 },
                    }),
                  },
                }
              : { kind: 'local' },
        },
      });
      expect(await handler(ownerId, accepted.jobId)).toMatchObject({
        success: true,
      });
      const detail = value(
        await sources.get({ ownerId, id: accepted.sourceId }),
      );
      expect(detail.version.status).toBe(
        indexing === 'text' || indexing === 'image' ? 'partial' : 'ready',
      );
      expect(detail.knowledgeDraftIds).toHaveLength(1);
      const draft = value(
        await knowledge.get(ownerId, detail.knowledgeDraftIds[0]!),
      );
      expect(draft.entry).toMatchObject({
        status: 'draft',
        savedBy: null,
        content: { summary: { support: 'needs_source' } },
      });
      expect(draft.citations[0]?.verification).toBe(
        indexing === 'review' ? 'needs_review' : 'located',
      );
      expect(draft.entry.content.history[0]?.support).toBe(
        indexing === 'review' ? 'needs_source' : 'cited',
      );
      expect(draft.citations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            locator: expect.objectContaining({
              sourceId: accepted.sourceId,
              sourceVersionId: accepted.sourceVersionId,
              pageId,
            }),
          }),
        ]),
      );
      expect(await handler(ownerId, accepted.jobId)).toMatchObject({
        success: true,
      });
      expect(
        value(await sources.get({ ownerId, id: accepted.sourceId }))
          .knowledgeDraftIds,
      ).toEqual(detail.knowledgeDraftIds);
      expect(
        value(
          await sources.get({
            ownerId,
            id: accepted.sourceId,
            versionId: accepted.sourceVersionId,
            pageId,
          }),
        ).pages.items[0],
      ).toMatchObject({
        id: pageId,
        rawText: '書頁原文：釉面觀察。',
        presentation,
        view,
      });
      const reprocessed = value(
        await sources.submit(ownerId, {
          mode: 'reprocess',
          requestKey: randomUUID(),
          sourceVersionId: accepted.sourceVersionId,
          pageIds: [pageId],
        }),
      );
      const missingPages = createSourceIngestionHandler({
        transaction,
        parser: {
          parse: async (input) => ({
            success: true,
            data: {
              sourceVersionId: input.sourceVersionId,
              parseRunId: input.parseRunId,
              rawOutputAssetId: originalAssetId,
              pages: [],
              regions: [],
              images: [],
              warnings: [],
            },
          }),
        },
        clock,
        ids,
      });
      expect(await missingPages(ownerId, reprocessed.jobId)).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      const selectedHandler = createSourceIngestionHandler({
        transaction,
        parser: {
          parse: async (request) => {
            const parsed = value(await parser.parse(request));

            return {
              success: true,
              data: {
                ...parsed,
                regions: [
                  {
                    id: randomUUID(),
                    sourceVersionId: accepted.sourceVersionId,
                    pageId,
                    kind: 'text',
                    region: {
                      kind: 'rect',
                      x: 0,
                      y: 0,
                      width: 0.5,
                      height: 0.5,
                    },
                    rawText: '原文',
                    relatedRegionIds: [],
                  },
                ],
                warnings: [
                  { pageId: null, messageZhHant: '全書提示' },
                  { pageId, messageZhHant: '頁面提示' },
                  { pageId: randomUUID(), messageZhHant: '其他頁面' },
                ],
              },
            };
          },
        },
        clock,
        ids,
      });
      expect(await selectedHandler(ownerId, reprocessed.jobId)).toMatchObject({
        success: true,
      });
      const refreshed = value(
        await sources.get({ ownerId, id: accepted.sourceId }),
      );
      expect(refreshed.pages.items.map((page) => page.id)).toEqual([pageId]);
      expect(refreshed.knowledgeDraftIds).toEqual(detail.knowledgeDraftIds);
      if (indexing === 'durable') {
        const retryJobId = randomUUID();
        value(
          await transaction.run(ownerId, async (unit) => {
            await unit.jobs.create({
              id: retryJobId,
              kind: 'sourceIngestion',
              resourceId: accepted.sourceVersionId,
              state: { kind: 'queued' },
              createdAt: clock.now(),
              updatedAt: clock.now(),
              result: null,
            });

            return { success: true, data: undefined };
          }),
        );
        const partialParser = createSourceIngestionHandler({
          transaction,
          parser: {
            submit: async (request) => {
              const parsed = value(
                await parser.parse({
                  sourceVersionId: request.sourceVersionId,
                  parseRunId: request.parseRunId,
                  originalAssetIds: [request.originalAssetId],
                }),
              );

              return {
                success: true,
                data: {
                  kind: 'completed',
                  pack: {
                    ...parsed,
                    pages: [],
                    images: [
                      ...parsed.images,
                      {
                        ...parsed.images[0]!,
                        id: randomUUID(),
                        locator: {
                          kind: 'web',
                          sourceId: accepted.sourceId,
                          sourceVersionId: accepted.sourceVersionId,
                          url: 'https://museum.example/figure',
                          retrievedAt: clock.now(),
                          snapshotAssetId: null,
                          blockId: null,
                          excerptAsRetrieved: null,
                        },
                        externalImageUrl: 'https://museum.example/figure.jpg',
                      },
                    ],
                  },
                },
              };
            },
            resume: async () => {
              throw new Error('No pending parse');
            },
          },
          clock,
          ids,
        });
        expect(await partialParser(ownerId, retryJobId)).toMatchObject({
          success: true,
        });
        const retried = value(
          await sources.get({ ownerId, id: accepted.sourceId }),
        );
        expect(retried.referenceImages).toContainEqual(
          expect.objectContaining({
            id: referenceImageId,
            locator: expect.objectContaining({
              kind: 'page',
              pageId,
              pageIndex: 0,
            }),
          }),
        );
        expect(retried.referenceImages).toContainEqual(
          expect.objectContaining({
            locator: expect.objectContaining({
              kind: 'web',
              url: 'https://museum.example/figure',
            }),
          }),
        );
        expect(retried.knowledgeDraftIds).toEqual(detail.knowledgeDraftIds);
      }

      expect(refreshed.regions).toHaveLength(1);
      const completed = value(
        await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.jobs.get(reprocessed.jobId),
        })),
      );
      expect(completed?.result).toMatchObject({
        warnings: [
          { pageId: null, messageZhHant: '全書提示' },
          { pageId, messageZhHant: '頁面提示' },
        ],
      });
    },
  );
});

describe('Source reads', () => {
  it('should sign only the selected historical page and deny foreign owners or pages before signing', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const signedKeys: string[] = [];
    const signer = {
      signRead: async (
        key: string,
      ): Promise<{ url: string; expiresAt: string }> => {
        signedKeys.push(key);

        return {
          url: `https://signed.example/${encodeURIComponent(key)}`,
          expiresAt: '2026-10-14T00:00:00.000Z',
        };
      },
    };
    const sources = createSourceService({
      transaction,
      clock,
      ids,
      signer,
    });
    let requestOwner = ownerId;
    const app = new Hono<ApiEnv>();
    app.use('*', async (context, next) => {
      context.set('ownerId', requestOwner);
      await next();
    });
    app.route(
      '/v1',
      createKnowledgeRoutes(
        sources,
        createKnowledgeService(transaction, clock, ids),
      ),
    );
    const command = await sourceInput(transaction, ownerId);
    const accepted = value(await sources.submit(ownerId, command));
    const assetId = command.registration.assets[0]!.assetId;
    const pages: Parameters<SourceRepository['saveParsed']>[0]['pages'] = [
      0, 1,
    ].map((pageIndex) => ({
      id: randomUUID(),
      sourceVersionId: accepted.sourceVersionId,
      pageIndex,
      printedPageLabel: String(pageIndex + 1),
      originalAssetId: assetId,
      pdfPageIndex: null,
      view: {
        id: randomUUID(),
        originalAssetId: assetId,
        derivativeId: randomUUID(),
        width: 100,
        height: 200,
        originalCoordinateSpace: 'image_pixels',
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
      presentation: null,
      rawText: `Page ${pageIndex}`,
      searchText: `Page ${pageIndex}`,
      quality: 'usable',
      regionIds: [],
    }));
    value(
      await transaction.run(ownerId, async (unit) => {
        for (const page of pages) {
          if (!page.view.derivativeId) {
            throw new Error('Photo fixture needs derivative');
          }
          await unit.media.addDerivative({
            id: page.view.derivativeId,
            originalAssetId: assetId,
            parentDerivativeId: null,
            kind: 'canonical',
            storageKey: `tests/${page.view.derivativeId}`,
            mimeType: 'image/jpeg',
            byteLength: 12,
            sha256: 'ab'.repeat(32),
            region: null,
            transformToOriginal: page.view.transformToOriginal,
          });
          await unit.media.addCanonicalView(page.view);
        }
        await unit.sources.saveParsed({
          sourceVersionId: accepted.sourceVersionId,
          parseRunId: accepted.jobId,
          rawOutputAssetId: assetId,
          pages,
          regions: [],
          images: [],
          warnings: [],
          mappings: [],
        });

        return { success: true, data: undefined };
      }),
    );
    const replacement = await sourceInput(transaction, ownerId);
    const current = value(
      await sources.submit(ownerId, {
        ...replacement,
        registration: {
          ...replacement.registration,
          existingSourceId: accepted.sourceId,
          expectedRevision: 1,
        },
      }),
    );
    const requestedPage = pages[0]!;
    const historicalUrl = `/v1/sources/${accepted.sourceId}?versionId=${accepted.sourceVersionId}&pageId=${requestedPage.id}`;
    const response = await app.request(historicalUrl);
    expect(response.status).toBe(200);
    const detail = (await response.json()) as {
      version: { id: string };
      reads: Array<{
        assetOrDerivativeId: string;
        url: string;
        expiresAt: string;
      }>;
    };
    expect(detail.version.id).toBe(accepted.sourceVersionId);
    expect(detail.reads.map((read) => read.assetOrDerivativeId).sort()).toEqual(
      [assetId, requestedPage.view.derivativeId].sort(),
    );
    expect(
      detail.reads.every(
        (read) =>
          read.url.startsWith('https://signed.example/') &&
          read.expiresAt === '2026-10-14T00:00:00.000Z',
      ),
    ).toBe(true);
    expect(signedKeys).toHaveLength(2);
    expect(signedKeys).toContain(`tests/${requestedPage.view.derivativeId}`);
    const latest = value(
      await sources.get({
        ownerId,
        id: accepted.sourceId,
        versionId: current.sourceVersionId,
      }),
    );
    expect(latest.reads.map((read) => read.assetOrDerivativeId)).toEqual([
      replacement.registration.assets[0]!.assetId,
    ]);
    const stored = value(
      await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.sources.get(
          accepted.sourceId,
          accepted.sourceVersionId,
          requestedPage.id,
        ),
      })),
    );
    expect(stored?.reads).toEqual([]);
    signedKeys.length = 0;
    const wrongPage = await app.request(
      `/v1/sources/${accepted.sourceId}?versionId=${current.sourceVersionId}&pageId=${requestedPage.id}`,
    );
    expect(wrongPage.status).toBe(404);
    requestOwner = randomUUID();
    expect((await app.request(historicalUrl)).status).toBe(404);
    expect(signedKeys).toEqual([]);
  });
});

describe('Source parsing concurrency', () => {
  it('should retry a persisted PDF page after JSON normalizes negative zero without accepting a different transform', async () => {
    const { ownerId, accepted, assetId, pack } = await (async () => {
      const database = createDatabase({
        url: resources['routes/knowledge']!.databaseUrl,
      });
      try {
        const ownerId = randomUUID();
        const transaction = createTransactionPort(database.db);
        const sources = createSourceService({
          transaction,
          clock,
          ids,
        });
        const command = await sourceInput(transaction, ownerId, {
          document: true,
        });
        const accepted = value(await sources.submit(ownerId, command));
        const assetId = command.registration.assets[0]!.assetId;
        const pageId = randomUUID();
        const pack: Parameters<SourceRepository['saveParsed']>[0] = {
          sourceVersionId: accepted.sourceVersionId,
          parseRunId: accepted.jobId,
          rawOutputAssetId: assetId,
          pages: [
            {
              id: pageId,
              sourceVersionId: accepted.sourceVersionId,
              pageIndex: 0,
              printedPageLabel: '1',
              originalAssetId: assetId,
              pdfPageIndex: 0,
              view: {
                id: randomUUID(),
                originalAssetId: assetId,
                derivativeId: null,
                width: 600,
                height: 800,
                originalCoordinateSpace: 'pdf_page_points',
                transformToOriginal: [1, -0, 0, 0, -1, 800, 0, 0, 1],
              },
              presentation: null,
              rawText: 'PDF text',
              searchText: 'pdf text',
              quality: 'usable',
              regionIds: [],
            },
          ],
          regions: [],
          images: [],
          warnings: [{ pageId, messageZhHant: '尚未探索圖片' }],
          mappings: [],
        };
        value(
          await transaction.run(ownerId, async (unit) => {
            await unit.sources.saveParsed(pack);

            return { success: true, data: undefined };
          }),
        );

        return { ownerId, accepted, assetId, pack };
      } finally {
        await database.close();
      }
    })();
    const reopened = createDatabase({
      url: resources['routes/knowledge']!.databaseUrl,
    });
    try {
      const resumed = createTransactionPort(reopened.db);
      value(
        await resumed.run(ownerId, async (unit) => {
          await unit.sources.saveParsed(pack);

          return { success: true, data: undefined };
        }),
      );
      const saved = value(
        await createSourceService({
          transaction: resumed,
          clock,
          ids,
          signer: {
            signRead: async (key: string) => ({
              url: `https://signed.example/${encodeURIComponent(key)}`,
              expiresAt: '2026-10-14T00:00:00.000Z',
            }),
          },
        }).get({
          ownerId,
          id: accepted.sourceId,
          versionId: accepted.sourceVersionId,
        }),
      );
      expect(saved.pages.items).toHaveLength(1);
      expect(saved.reads.map((read) => read.assetOrDerivativeId)).toEqual([
        assetId,
      ]);
      expect(saved.pages.items[0]!.view).toMatchObject({
        id: pack.pages[0]!.view.id,
        derivativeId: null,
        originalCoordinateSpace: 'pdf_page_points',
        transformToOriginal: [1, 0, 0, 0, -1, 800, 0, 0, 1],
      });
      await expect(
        resumed.run(ownerId, async (unit) => {
          await unit.sources.saveParsed({
            ...pack,
            pages: [
              {
                ...pack.pages[0]!,
                view: {
                  ...pack.pages[0]!.view,
                  transformToOriginal: [2, 0, 0, 0, -1, 800, 0, 0, 1],
                },
              },
            ],
          });

          return { success: true, data: undefined };
        }),
      ).rejects.toThrow(/view/i);
    } finally {
      await reopened.close();
    }
  });

  it('should preserve a newer parse publication when an older parser completes late', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const sources = createSourceService({
      transaction,
      clock,
      ids,
    });
    const command = await sourceInput(transaction, ownerId);
    const accepted = value(await sources.submit(ownerId, command));
    const newerParseRunId = randomUUID();
    const parser: SourceParsingPort = {
      parse: async (input) => {
        value(
          await transaction.run(ownerId, async (unit) => {
            const current = await unit.sources.getVersion(
              input.sourceVersionId,
            );
            if (!current) {
              throw new Error('Source fixture disappeared');
            }
            const updated = await unit.sources.updateVersion(
              {
                ...current,
                status: 'ready',
                textIndexStatus: 'ready',
                activeParseRunId: newerParseRunId,
              },
              current.status,
              current.activeParseRunId,
            );
            if (!updated) {
              throw new Error('Concurrent publication fixture failed');
            }

            return { success: true, data: undefined };
          }),
        );

        return {
          success: true,
          data: {
            sourceVersionId: input.sourceVersionId,
            parseRunId: input.parseRunId,
            rawOutputAssetId: command.registration.assets[0]!.assetId,
            pages: [],
            regions: [],
            images: [],
            warnings: [],
          },
        };
      },
    };
    expect(
      await createSourceIngestionHandler({
        transaction,
        parser,
        clock,
        ids,
      })(ownerId, accepted.jobId),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      value(await sources.get({ ownerId, id: accepted.sourceId })).version
        .activeParseRunId,
    ).toBe(newerParseRunId);
  });
});

describe('Knowledge HTTP validation', () => {
  it('should create, save, filter and reopen knowledge through its HTTP contract', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const app = new Hono<ApiEnv>();
    app.use('*', async (context, next) => {
      context.set('ownerId', ownerId);
      await next();
    });
    app.route(
      '/v1',
      createKnowledgeRoutes(
        createSourceService({
          transaction,
          clock,
          ids,
        }),
        createKnowledgeService(transaction, clock, ids),
      ),
    );
    const input = knowledgeInput();
    const created = await app.request('/v1/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    expect(created.status).toBe(201);
    const draft = (await created.json()) as { entry: { id: string } };
    const saved = await app.request(`/v1/knowledge/${draft.entry.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input,
        requestKey: randomUUID(),
        expectedRevision: 1,
        status: 'saved',
        methodWrites: [],
      }),
    });
    expect(saved.status).toBe(200);
    const historical = await app.request(
      `/v1/knowledge/${draft.entry.id}?revision=1`,
    );
    expect(await historical.json()).toMatchObject({
      entry: { id: draft.entry.id, revision: 1, status: 'draft' },
    });
    const list = await app.request(
      '/v1/knowledge?status=saved&kinds=surface&includeUnknown=true&limit=10',
    );
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({
      items: [{ id: draft.entry.id, status: 'saved' }],
    });
    const command = await sourceInput(transaction, ownerId);
    const registered = await app.request('/v1/sources', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(command),
    });
    expect(registered.status).toBe(202);
    const accepted = (await registered.json()) as {
      sourceId: string;
      sourceVersionId: string;
    };
    const source = await app.request(
      `/v1/sources/${accepted.sourceId}?versionId=${accepted.sourceVersionId}&limit=1`,
    );
    expect(source.status).toBe(200);
    expect(await source.json()).toMatchObject({
      source: { id: accepted.sourceId },
    });
  });

  it('should reject out-of-range page limits and conflicting exact and paginated locators', async ({
    fixture,
  }) => {
    const database = fixture.runtime.database;
    const transaction = createTransactionPort(database.db);
    const app = new Hono<ApiEnv>();
    app.use('*', async (context, next) => {
      context.set('ownerId', randomUUID());
      await next();
    });
    app.route(
      '/v1',
      createKnowledgeRoutes(
        createSourceService({
          transaction,
          clock,
          ids,
        }),
        createKnowledgeService(transaction, clock, ids),
      ),
    );
    for (const query of [
      'limit=0',
      'limit=101',
      'limit=1.5',
      `pageId=${randomUUID()}&pageCursor=next`,
      'pageId=invalid',
    ]) {
      const response = await app.request(
        `/v1/sources/${randomUUID()}?${query}`,
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    }
  });
});

/**
 * pauses one real owner-scoped version read while another public worker advances
 * @param transaction real database transaction boundary
 * @param versionId only source version eligible for the barrier
 * @returns pass-through transaction and an exception-safe race coordinator
 */
function createVersionReadBarrier(
  transaction: TransactionPort,
  versionId: string,
): {
  readonly transaction: TransactionPort;
  arm(): void;
  race<T>(
    operation: () => Promise<T>,
    advance: () => Promise<void>,
  ): Promise<T>;
} {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let isArmed = false;
  const forwarded: TransactionPort = {
    async run<T extends OperationResult<unknown>>(
      ownerId: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> {
      return transaction.run(ownerId, async (unit) =>
        operation({
          ...unit,
          sources: {
            ...unit.sources,
            getVersion: async (id) => {
              const version = await unit.sources.getVersion(id);
              if (isArmed && id === versionId) {
                isArmed = false;
                reached.resolve();
                await release.promise;
              }

              return version;
            },
          },
        }),
      );
    },
  };

  return {
    transaction: forwarded,
    arm: () => {
      isArmed = true;
    },
    async race<T>(
      operation: () => Promise<T>,
      advance: () => Promise<void>,
    ): Promise<T> {
      const expired = Promise.withResolvers<never>();
      const timeout = setTimeout(
        () =>
          expired.reject(new Error('Version read barrier deadline exceeded')),
        2_000,
      );
      const worker = Promise.resolve().then(operation);
      let competitor: Promise<void> | undefined;
      try {
        await Promise.race([
          reached.promise,
          worker.then(() => {
            throw new Error(
              'Worker settled before reaching the version read barrier',
            );
          }),
          expired.promise,
        ]);
        competitor = advance();
        await Promise.race([competitor, expired.promise]);
        release.resolve();

        return await Promise.race([worker, expired.promise]);
      } finally {
        release.resolve();
        clearTimeout(timeout);
        await Promise.allSettled([worker, competitor]);
      }
    },
  };
}

async function createProjection(fixture: HttpFixture) {
  const transaction = fixture.runtime.transaction;
  const sources = createSourceService({
    transaction,
    clock,
    ids,
  });
  const knowledge = createKnowledgeService(transaction, clock, ids);
  const command = await sourceInput(transaction, collectorUserId, {
    document: true,
  });
  const accepted = value(await sources.submit(collectorUserId, command));
  const assetId = command.registration.assets[0]!.assetId;
  const pages: ParsedSourcePack['pages'] = [0, 1].map((pageIndex) => ({
    id: randomUUID(),
    sourceVersionId: accepted.sourceVersionId,
    pageIndex,
    printedPageLabel: String(pageIndex + 1),
    originalAssetId: assetId,
    pdfPageIndex: pageIndex,
    view: {
      id: randomUUID(),
      originalAssetId: assetId,
      derivativeId: null,
      width: 600,
      height: 800,
      originalCoordinateSpace: 'pdf_page_points',
      transformToOriginal: [1, 0, 0, 0, -1, 800, 0, 0, 1],
    },
    presentation: null,
    rawText: '',
    searchText: '',
    quality: 'usable',
    regionIds: [],
  }));
  const pack = (
    parseRunId: string,
    selected: readonly number[],
    revision: string,
  ): ParsedSourcePack => {
    const parsedPages = selected.map((index) => ({
      ...pages[index]!,
      rawText: revision === 'empty' ? '' : `Page ${index} ${revision} passage`,
      searchText: revision === 'empty' ? '' : `normalized ${index} ${revision}`,
      quality:
        revision === 'empty' ? ('needs_review' as const) : ('usable' as const),
      regionIds: revision === 'empty' ? [] : [randomUUID()],
    }));

    return {
      sourceVersionId: accepted.sourceVersionId,
      parseRunId,
      rawOutputAssetId: assetId,
      pages: parsedPages,
      regions: parsedPages.flatMap((page) =>
        page.regionIds.map((id) => ({
          id,
          sourceVersionId: accepted.sourceVersionId,
          pageId: page.id,
          kind: 'text' as const,
          region: {
            kind: 'rect' as const,
            x: 0.1,
            y: 0.1,
            width: 0.5,
            height: 0.2,
          },
          rawText: page.rawText,
          relatedRegionIds: [],
        })),
      ),
      images: [],
      warnings: [],
    };
  };
  const original = pack(accepted.jobId, [0, 1], 'original');
  value(
    await createSourceIngestionHandler({
      transaction,
      parser: {
        parse: async () => ({ success: true, data: original }),
      },
      clock,
      ids,
    })(collectorUserId, accepted.jobId),
  );

  return { sources, knowledge, accepted, original, pack };
}

function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
