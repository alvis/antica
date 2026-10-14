import { createHash, randomUUID } from 'node:crypto';

import { inject, describe, expect, vi } from 'vitest';

import { z } from 'zod';

import {
  sourceAcceptedSchema,
  sourceDetailSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { collectorUserId, readKnowledgeConfiguration } from '@antica/platform';

import { createHttpTest } from './fixtures/http/test.js';
import { createLocalSettings } from './fixtures/runtime.js';

const resources = inject('httpResources');
const knowledge = readKnowledgeConfiguration({
  ANTICA_PARSING_DRIVER: 'llama',
  ANTICA_TEXT_SEARCH_DRIVER: 'llama',
  LLAMA_CLOUD_INDEX_ID: 'test-index',
  LLAMA_CLOUD_SOURCE_DIRECTORY_ID: 'test-directory',
  LLAMA_TEXT_EMBEDDING_MODEL_ID: 'embedding',
  LLAMA_TEXT_DIMENSIONS: '8',
  ANTICA_TEXT_INDEX_VERSION: 'test-v1',
  LLAMA_CLOUD_API_KEY: 'synthetic-test-key',
  LLAMA_PARSE_VERSION: '2026-09-01',
});
if (!knowledge.success) {
  throw new Error('Invalid parser fixture config');
}
const it = createHttpTest(resources['cloud-text-index']!, {
  ...createLocalSettings(),
  knowledge: knowledge.data,
});

describe('Configured durable cloud text indexing', () => {
  it('should retain checkpoints and canonical chunk mappings before the first research snapshot', async ({
    fixture,
  }) => {
    expect(
      await fixture.runtime.database.db.execute(
        'SELECT id FROM index_versions',
      ),
    ).toHaveLength(0);
    const providerJobId = randomUUID();
    const uploadedOriginals: Uint8Array[] = [];
    const paths: string[] = [];
    let synced = false;
    let metadata: Record<string, unknown> = {};
    const indexedText: string[] = [];
    const transport = vi.fn<typeof fetch>(async (...args) => {
      if (args[0] === 'data:,') {
        return new Response();
      }
      const request = new Request(args[0], args[1]);
      const url = new URL(request.url);
      paths.push(`${request.method} ${url.pathname}`);
      if (request.headers.get('content-type')?.includes('multipart')) {
        const form = await request.formData();
        const original = form.get('file');
        if (original instanceof File) {
          uploadedOriginals.push(new Uint8Array(await original.arrayBuffer()));

          return Response.json({ id: providerJobId, status: 'PENDING' });
        }
        const file = form.get('upload_file');
        if (!(file instanceof File)) {
          throw new Error('Missing canonical text upload');
        }
        indexedText.push(await file.text());
        metadata = z
          .record(z.string(), z.unknown())
          .parse(JSON.parse(z.string().parse(form.get('metadata'))));

        return Response.json({
          id: 'canonical-file',
          directory_id: 'test-directory',
          unique_id: form.get('unique_id'),
          metadata,
        });
      }
      if (url.pathname.includes('/parse/')) {
        return Response.json({
          job: { id: providerJobId, status: 'COMPLETED' },
          text: { pages: [{ page_number: 1, text: 'Retained glaze text' }] },
        });
      }
      if (url.pathname.endsWith('/sync')) {
        synced = true;

        return Response.json({});
      }
      if (request.method === 'GET' && url.pathname.includes('/indexes/')) {
        return Response.json({
          id: 'test-index',
          source_directory_id: 'test-directory',
          last_exported_at: synced ? 'new' : 'old',
          metadata: { status: 'ready' },
          sync_in_progress: false,
        });
      }
      if (url.pathname.includes('/retrieval')) {
        return Response.json({
          results: [
            {
              content: 'Retained glaze text',
              metadata,
              static_fields: {
                parsed_directory_file_id: 'canonical-file',
                chunk_index: 0,
              },
            },
          ],
        });
      }
      throw new Error(
        `Unexpected fake provider request ${request.method} ${url.pathname}`,
      );
    });
    vi.stubGlobal('fetch', transport);
    const intakeKey = randomUUID();
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
      'base64',
    );
    const upload = uploadSessionSchema.parse(
      await (
        await fixture.request('/v1/media/uploads', 'POST', {
          requestKey: randomUUID(),
          target: { kind: 'source_intake', intakeKey },
          kind: 'photo',
          purpose: 'book_page',
          componentIds: [],
          fileName: 'page.png',
          mimeType: 'image/png',
          byteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      ).json(),
    );
    if (upload.mode !== 'single') {
      throw new Error('Expected local single upload');
    }
    expect(
      (
        await fixture.runtime.app.request(upload.putUrl, {
          method: 'PUT',
          headers: upload.headers,
          body: bytes,
        })
      ).status,
    ).toBe(204);
    expect(
      (
        await fixture.request(`/v1/media/${upload.assetId}/complete`, 'POST', {
          requestKey: randomUUID(),
        })
      ).status,
    ).toBe(200);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const registered = await fixture.request('/v1/sources', 'POST', {
      mode: 'register',
      requestKey: randomUUID(),
      registration: {
        intakeKey,
        kind: 'book_pages',
        existingSourceId: null,
        expectedRevision: null,
        assets: [
          { assetId: upload.assetId, order: 0, printedPageLabel: '十二' },
        ],
        metadata: {
          title: '器物研究',
          contributors: [],
          authorStatus: 'unknown',
          editionStatement: null,
          publisher: null,
          publicationDateAsPrinted: null,
          isbn: null,
          languages: ['zh-Hant'],
          canonicalUrl: null,
          access: 'stored_copy',
          rightsStatement: null,
          attributionText: null,
        },
      },
    });
    expect(registered.status).toBe(202);
    const accepted = sourceAcceptedSchema.parse(await registered.json());
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 0,
      deferred: 1,
      failures: [],
    });
    expect(uploadedOriginals).toEqual([new Uint8Array(bytes)]);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.advanceTimersByTime(6000);
    expect(await fixture.runtime.drain(), JSON.stringify(paths)).toMatchObject({
      settled: 0,
      deferred: 1,
      failures: [],
    });
    for (const phase of ['inspect', 'upload', 'sync', 'wait']) {
      vi.advanceTimersByTime(2000);
      expect(await fixture.runtime.drain(), phase).toMatchObject({
        settled: 0,
        deferred: 1,
        failures: [],
      });
    }
    expect(indexedText).toEqual(['Retained glaze text']);
    expect(metadata).toMatchObject({
      anticaOwnerId: collectorUserId,
      anticaSourceVersionId: accepted.sourceVersionId,
      anticaIndexVersion: 'test-v1',
    });
    vi.advanceTimersByTime(2000);
    expect(await fixture.runtime.drain()).toMatchObject({
      settled: 1,
      failures: [],
    });
    const mapping = await fixture.runtime.transaction.run(
      collectorUserId,
      async (unit) => ({
        success: true,
        data: await unit.sources.resolveProviderChunk(
          'llama-cloud',
          'test-v1',
          'canonical-file:0',
        ),
      }),
    );
    expect(mapping.data).toMatchObject({
      sourceVersionId: accepted.sourceVersionId,
      indexVersion: 'test-v1',
      canonicalRegionIds: metadata.anticaRegionIds,
    });
    const registeredIndexes = await fixture.runtime.database.db.execute(
      'SELECT kind, embedding_model_id, dimensions FROM index_versions',
    );
    expect(registeredIndexes.map((row) => ({ ...row }))).toEqual([
      { kind: 'text', embedding_model_id: 'embedding', dimensions: 8 },
    ]);
    expect(
      await fixture.runtime.text.snapshot('glaze', fixture.runtime.textIndex),
    ).toMatchObject({
      success: false,
      error: { code: 'SOURCE_UNAVAILABLE', retryable: false },
    });
    const detail = sourceDetailSchema.parse(
      await (await fixture.request(`/v1/sources/${accepted.sourceId}`)).json(),
    );
    expect(detail.version).toMatchObject({
      id: accepted.sourceVersionId,
      status: 'partial',
    });
    expect(detail.pages.items).toMatchObject([
      {
        originalAssetId: upload.assetId,
        printedPageLabel: '十二',
        rawText: 'Retained glaze text',
        quality: 'needs_review',
      },
    ]);
    expect(detail.referenceImages).toHaveLength(1);
    const reviewedId = randomUUID();
    await fixture.runtime.transaction.run(collectorUserId, async (unit) => {
      const citation = await unit.sources.getCitation(
        z.string().parse(metadata.anticaCitationId),
      );
      if (citation?.locator.kind !== 'page') {
        throw new Error('Expected the actual parsed page citation');
      }
      await unit.sources.addCitation({
        ...citation,
        id: reviewedId,
        verification: 'located',
        locator: {
          ...citation.locator,
          regionId: z.array(z.string()).parse(metadata.anticaRegionIds)[0]!,
          region: { kind: 'rect', x: 0, y: 0, width: 1, height: 1 },
        },
      });

      return { success: true, data: undefined };
    });
    expect(
      await fixture.runtime.text.snapshot('glaze', fixture.runtime.textIndex),
    ).toMatchObject({
      success: true,
      data: {
        citations: [
          expect.objectContaining({ id: reviewedId, verification: 'located' }),
        ],
        text: [
          {
            citationId: reviewedId,
            contentAsRetrieved: 'Retained glaze text',
            sourceRegionId: z
              .array(z.string())
              .parse(metadata.anticaRegionIds)[0],
          },
        ],
      },
    });

    expect(
      (await fixture.runtime.storage.read(`originals/${upload.assetId}`)).bytes,
    ).toEqual(bytes);
    expect(await fixture.runtime.drain()).toMatchObject({
      inspected: 0,
      settled: 0,
    });
  });
});
