import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { describe, expect, it } from 'vitest';

import {
  createKnowledgeService,
  createSourceService,
  createSourceIngestionHandler,
} from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';

import { knowledgeInput } from '../fixtures/knowledge.js';
import { sourceInput } from '../fixtures/source.js';

import { createKnowledgeRoutes } from './knowledge.js';

import type {
  OperationResult,
  SourceRepository,
  SourceParsingPort,
} from '@antica/application/ports';

import type { ApiEnv } from '../http.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Persistent knowledge revisions', () => {
  it('should retain the original draft and method when the collector saves a new revision', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
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
      expect(
        value(await service.get(ownerId, draft.entry.id, 1)),
      ).toMatchObject({
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
    } finally {
      await database.close();
    }
  });

  it('should replay an identical create request and reject a changed request without creating another entry', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
      const input = knowledgeInput();
      const first = value(await service.create(ownerId, input));
      expect(value(await service.create(ownerId, input))).toEqual(first);
      expect(
        await service.create(ownerId, { ...input, status: 'saved' }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(
        value(await service.list(ownerId, {})).items.map((item) => item.id),
      ).toEqual([first.entry.id]);
    } finally {
      await database.close();
    }
  });

  it('should roll back an entry whose linked method is unavailable', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
      const input = { ...knowledgeInput(), linkedMethodIds: [randomUUID()] };
      expect(await service.create(ownerId, input)).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      expect(value(await service.list(ownerId, {})).items).toEqual([]);
      expect(
        await service.create(ownerId, { ...input, linkedMethodIds: [] }),
      ).toMatchObject({ success: true });
    } finally {
      await database.close();
    }
  });

  it('should keep missing support visibly marked and reject invented citation identifiers', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createKnowledgeService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
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
    } finally {
      await database.close();
    }
  });
});

describe('Explicit source intake', () => {
  it('should register ready intake pages only on command and persist one queued ingestion job on replay', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService(transaction, clock, ids);
    try {
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
      const detail = value(await service.get(ownerId, accepted.sourceId));
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
      expect(await service.get(randomUUID(), accepted.sourceId)).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
    } finally {
      await database.close();
    }
  });

  it('should reject unfinished uploads and assets belonging to another intake', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService(transaction, clock, ids);
    try {
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
    } finally {
      await database.close();
    }
  });

  it('should retain a failed parsing job for an explicit retry without publishing knowledge', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const service = createSourceService(transaction, clock, ids);
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
    try {
      const accepted = value(
        await service.submit(ownerId, await sourceInput(transaction, ownerId)),
      );
      expect(
        await createSourceIngestionHandler(
          transaction,
          parser,
          clock,
          ids,
        )(ownerId, accepted.jobId),
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
        value(await service.get(ownerId, accepted.sourceId)).knowledgeDraftIds,
      ).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it.each(['local', 'text', 'image', 'durable', 'review'] as const)(
    'should expose parsed source text as a draft and retain its page locator with %s indexing',
    async (indexing) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      const sources = createSourceService(transaction, clock, ids);
      const knowledge = createKnowledgeService(transaction, clock, ids);
      try {
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
        const handler = createSourceIngestionHandler(
          transaction,
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
          {
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
        );
        expect(await handler(ownerId, accepted.jobId)).toMatchObject({
          success: true,
        });
        const detail = value(await sources.get(ownerId, accepted.sourceId));
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
          value(await sources.get(ownerId, accepted.sourceId))
            .knowledgeDraftIds,
        ).toEqual(detail.knowledgeDraftIds);
        expect(
          value(
            await sources.get(
              ownerId,
              accepted.sourceId,
              accepted.sourceVersionId,
              pageId,
            ),
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
        const missingPages = createSourceIngestionHandler(
          transaction,
          {
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
        );
        expect(await missingPages(ownerId, reprocessed.jobId)).toMatchObject({
          success: false,
          error: { code: 'SOURCE_UNAVAILABLE' },
        });
        const selectedHandler = createSourceIngestionHandler(
          transaction,
          {
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
        );
        expect(await selectedHandler(ownerId, reprocessed.jobId)).toMatchObject(
          {
            success: true,
          },
        );
        const refreshed = value(await sources.get(ownerId, accepted.sourceId));
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
          const partialParser = createSourceIngestionHandler(
            transaction,
            {
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
          );
          expect(await partialParser(ownerId, retryJobId)).toMatchObject({
            success: true,
          });
          const retried = value(await sources.get(ownerId, accepted.sourceId));
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
      } finally {
        await database.close();
      }
    },
  );
});

describe('Source reads', () => {
  it('should sign only the selected historical page and deny foreign owners or pages before signing', async () => {
    const database = createDatabase({ url: databaseUrl });
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
    const sources = createSourceService(transaction, clock, ids, signer);
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
    try {
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
      expect(
        detail.reads.map((read) => read.assetOrDerivativeId).sort(),
      ).toEqual([assetId, requestedPage.view.derivativeId].sort());
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
        await sources.get(ownerId, accepted.sourceId, current.sourceVersionId),
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
    } finally {
      await database.close();
    }
  });
});

describe('Source parsing concurrency', () => {
  it('should retry a persisted PDF page after JSON normalizes negative zero without accepting a different transform', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const sources = createSourceService(transaction, clock, ids);
    try {
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
      await database.close();
      const reopened = createDatabase({ url: databaseUrl });
      try {
        const resumed = createTransactionPort(reopened.db);
        value(
          await resumed.run(ownerId, async (unit) => {
            await unit.sources.saveParsed(pack);

            return { success: true, data: undefined };
          }),
        );
        const saved = value(
          await createSourceService(resumed, clock, ids, {
            signRead: async (key: string) => ({
              url: `https://signed.example/${encodeURIComponent(key)}`,
              expiresAt: '2026-10-14T00:00:00.000Z',
            }),
          }).get(ownerId, accepted.sourceId, accepted.sourceVersionId),
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
    } finally {
      await database.close();
    }
  });

  it('should preserve a newer parse publication when an older parser completes late', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const sources = createSourceService(transaction, clock, ids);
    try {
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
        await createSourceIngestionHandler(
          transaction,
          parser,
          clock,
          ids,
        )(ownerId, accepted.jobId),
      ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
      expect(
        value(await sources.get(ownerId, accepted.sourceId)).version
          .activeParseRunId,
      ).toBe(newerParseRunId);
    } finally {
      await database.close();
    }
  });
});

describe('Knowledge HTTP validation', () => {
  it('should create, save, filter and reopen knowledge through its HTTP contract', async () => {
    const database = createDatabase({ url: databaseUrl });
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
        createSourceService(transaction, clock, ids),
        createKnowledgeService(transaction, clock, ids),
      ),
    );
    try {
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
    } finally {
      await database.close();
    }
  });

  it('should reject out-of-range page limits and conflicting exact and paginated locators', async () => {
    const database = createDatabase({ url: databaseUrl });
    const transaction = createTransactionPort(database.db);
    const app = new Hono<ApiEnv>();
    app.use('*', async (context, next) => {
      context.set('ownerId', randomUUID());
      await next();
    });
    app.route(
      '/v1',
      createKnowledgeRoutes(
        createSourceService(transaction, clock, ids),
        createKnowledgeService(transaction, clock, ids),
      ),
    );
    try {
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
    } finally {
      await database.close();
    }
  });
});

function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
