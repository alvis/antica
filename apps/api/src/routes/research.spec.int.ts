import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { describe, expect, it, vi } from 'vitest';

import {
  createImageSearchService,
  createResearchHandler,
  createRecordService,
  createResearchService,
} from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';

import { createResearchRoutes } from './research.js';

import type {
  OperationResult,
  TransactionPort,
} from '@antica/application/ports';
import type {
  NoteInput,
  ReferenceInput,
  ResearchRequest,
} from '@antica/contracts';

import type { ApiEnv } from '../http.js';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Persistent explicit research', () => {
  it('should persist one queued request and reject idempotency reuse with a different instruction', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const request = researchInput();
      const accepted = value(await research.submit(ownerId, request));
      expect(value(await research.submit(ownerId, request))).toEqual(accepted);
      expect(
        await research.submit(ownerId, {
          ...request,
          instructionZhHant: '另一個問題',
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(
        value(await research.get(ownerId, accepted.researchId)),
      ).toMatchObject({
        request,
        state: { kind: 'queued' },
        draft: null,
        notes: [],
      });
      expect(
        value(
          await transaction.run(ownerId, async (unit) => ({
            success: true,
            data: await unit.outbox.pending(100),
          })),
        ).map((message) => message.name),
      ).toEqual(['research']);
      expect(
        await research.get(randomUUID(), accepted.researchId),
      ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    } finally {
      await database.close();
    }
  });

  it('should reject curated research without sources and inaccessible record context', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      expect(
        await research.submit(ownerId, {
          ...researchInput(),
          scope: 'curated_only',
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(
        await research.submit(ownerId, {
          ...researchInput(),
          recordId: randomUUID(),
        }),
      ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect(
        value(
          await transaction.run(ownerId, async (unit) => ({
            success: true,
            data: await unit.outbox.pending(100),
          })),
        ),
      ).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('should reopen a collector-saved cited note after closing its database connection', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const input = await noteInput(transaction, ownerId);
      const note = value(await research.saveNote(ownerId, input));
      expect(value(await research.saveNote(ownerId, input))).toEqual(note);
      await database.close();
      const reopened = createDatabase({ url: databaseUrl });
      try {
        const detail = value(
          await createResearchService(
            createTransactionPort(reopened.db),
            clock,
            ids,
          ).get(ownerId, input.researchId),
        );
        expect(detail.notes).toEqual([note]);
        expect(detail.notes[0]).toMatchObject({
          savedBy: 'collector',
          citations: input.citations,
          paragraphs: input.paragraphs,
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should reject stale draft revisions and citations altered after retrieval without saving a note', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const input = await noteInput(transaction, ownerId);
      expect(
        await research.saveNote(ownerId, {
          ...input,
          expectedDraftRevision: 2,
        }),
      ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
      const citation = input.citations[0]!;
      expect(
        await research.saveNote(ownerId, {
          ...input,
          citations: [{ ...citation, relation: 'comparison' }],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      expect(
        await research.saveNote(ownerId, {
          ...input,
          paragraphs: [
            {
              textZhHant: '未找到引用',
              support: 'cited',
              citationIds: [randomUUID()],
            },
          ],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      expect(
        value(await research.get(ownerId, input.researchId)).notes,
      ).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it('should require a completed research draft before saving a note', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const accepted = value(await research.submit(ownerId, researchInput()));
      expect(
        await research.saveNote(ownerId, {
          requestKey: randomUUID(),
          researchId: accepted.researchId,
          expectedDraftRevision: 1,
          titleZhHant: '未完成',
          paragraphs: [],
          citations: [],
          recordId: null,
          entryId: null,
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
    } finally {
      await database.close();
    }
  });

  it('should save a reference once, advance analysis input once, and preserve it across reconnection', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const input = await referenceInput(transaction, ownerId);
      const link = value(await research.addReference(ownerId, input));
      expect(link.versions).toEqual({
        recordRevision: 2,
        analysisInputVersion: 2,
        evidenceVersion: 1,
      });
      expect(value(await research.addReference(ownerId, input))).toEqual(link);
      expect(
        value(
          await research.addReference(ownerId, {
            ...input,
            requestKey: randomUUID(),
          }),
        ),
      ).toEqual(link);
      const record = value(
        await createRecordService(transaction, clock, ids).get(
          ownerId,
          input.target.recordId,
        ),
      );
      expect(record).toMatchObject({
        recordRevision: 2,
        analysisInputVersion: 2,
        latestRunId: null,
      });
      await database.close();
      const reopened = createDatabase({ url: databaseUrl });
      try {
        const service = createResearchService(
          createTransactionPort(reopened.db),
          clock,
          ids,
        );
        expect(
          value(
            await service.listReferences(ownerId, input.target.recordId, {}),
          ).items,
        ).toEqual([link]);
        expect(
          await service.listReferences(randomUUID(), input.target.recordId, {}),
        ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should reject foreign evidence and stale record revisions without leaving a reference', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const input = await referenceInput(transaction, ownerId);
      expect(
        await research.addReference(ownerId, {
          ...input,
          target: { ...input.target, evidenceAnchorId: randomUUID() },
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
      expect(
        await research.addReference(ownerId, {
          ...input,
          expectedRecordRevision: 2,
        }),
      ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
      expect(
        value(await research.listReferences(ownerId, input.target.recordId, {}))
          .items,
      ).toEqual([]);
      expect(
        value(
          await createRecordService(transaction, clock, ids).get(
            ownerId,
            input.target.recordId,
          ),
        ).recordRevision,
      ).toBe(1);
    } finally {
      await database.close();
    }
  });
});

describe('Canonical source references', () => {
  it('should reject a forged web URL while accepting the stored source locator', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    try {
      const input = await referenceInput(transaction, ownerId);
      const sourceId = randomUUID();
      const sourceVersionId = randomUUID();
      const url = 'https://museum.example/catalogue/original';
      const metadata = {
        title: '館藏原始記錄',
        contributors: [],
        authorStatus: 'unknown' as const,
        editionStatement: null,
        publisher: null,
        publicationDateAsPrinted: null,
        isbn: null,
        languages: ['zh-Hant'],
        canonicalUrl: url,
        access: 'link_only' as const,
        rightsStatement: null,
        attributionText: null,
      };
      value(
        await transaction.run(ownerId, async (unit) => {
          await unit.sources.create(
            {
              id: sourceId,
              revision: 1,
              createdAt: clock.now(),
              updatedAt: clock.now(),
              kind: 'web',
              metadata,
              currentVersionId: sourceVersionId,
            },
            {
              id: sourceVersionId,
              sourceId,
              originalAssetIds: [],
              sourceHash: randomUUID(),
              metadataSnapshot: metadata,
              capturedAt: clock.now(),
              retrievedAt: clock.now(),
              status: 'ready',
              textIndexStatus: 'ready',
              imageIndexStatus: 'partial',
              activeParseRunId: null,
            },
            [],
          );

          return { success: true, data: undefined };
        }),
      );
      const locator = {
        kind: 'web' as const,
        sourceId,
        sourceVersionId,
        url,
        retrievedAt: clock.now(),
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      };
      expect(
        await research.addReference(ownerId, {
          ...input,
          reference: {
            kind: 'source',
            referenceImageId: null,
            locator: { ...locator, url: 'https://attacker.example/fabricated' },
          },
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
      expect(
        value(await research.listReferences(ownerId, input.target.recordId, {}))
          .items,
      ).toEqual([]);
      expect(
        await research.addReference(ownerId, {
          ...input,
          reference: { kind: 'source', referenceImageId: null, locator },
        }),
      ).toMatchObject({ success: true, data: { reference: { locator } } });
    } finally {
      await database.close();
    }
  });
});

describe('Research HTTP validation', () => {
  it('should reuse frozen retrieval after a model failure and make completed job replay inert', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    let searches = 0;
    let drafts = 0;
    const draft = {
      revision: 1,
      titleZhHant: '資料不足',
      paragraphs: [
        {
          textZhHant: '尚需來源',
          support: 'needs_source' as const,
          citationIds: [],
        },
      ],
      citations: [],
      unresolvedQuestionsZhHant: ['尚無可靠來源'],
    };
    try {
      const accepted = value(await research.submit(ownerId, researchInput()));
      const handler = createResearchHandler({
        transaction,
        clock,
        ids,
        text: {
          snapshot: async () => {
            throw new Error('No curated sources selected');
          },
          search: async () => {
            throw new Error('Unexpected text search');
          },
        },
        web: {
          search: async () => {
            searches += 1;

            return { success: true, data: [] };
          },
        },
        catalog: {
          resolve: async () => ({
            success: true,
            data: {
              effectiveModelId: 'test',
              capabilities: {
                textInput: true,
                imageInput: false,
                audioInput: false,
                structuredOutput: true,
                toolCalling: false,
              },
            },
          }),
        },
        model: {
          draft: async () => {
            drafts += 1;

            return drafts === 1
              ? {
                  success: false,
                  error: {
                    code: 'PROVIDER_UNAVAILABLE',
                    message: 'Temporary failure',
                    retryable: true,
                  },
                  audit: { invocation: null, rawOutput: null },
                }
              : {
                  success: true,
                  data: {
                    value: draft,
                    invocation: {
                      requestedModelId: 'test',
                      effectiveModelId: 'test',
                      provider: 'test',
                      providerModelVersion: null,
                      adapterKind: 'development',
                      capabilities: {
                        textInput: true,
                        imageInput: false,
                        audioInput: false,
                        structuredOutput: true,
                        toolCalling: false,
                      },
                      role: 'research',
                      profileVersion: 'v1',
                      promptVersion: 'v1',
                      schemaVersion: 'v1',
                      effectiveOptions: {},
                      latencyMs: 1,
                      usage: { inputTokens: 0, outputTokens: 0 },
                      finishReason: 'stop',
                      citationCheck: { valid: true, rejectedReferenceIds: [] },
                    },
                  },
                };
          },
        },
        index: {
          embeddingModelId: 'test',
          dimensions: 3,
          indexVersion: 'lexical-v1',
        },
        selection: { role: 'research', modelId: 'test', profileVersion: 'v1' },
      });
      expect(await handler(ownerId, accepted.jobId)).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE' },
      });
      expect(
        value(await research.get(ownerId, accepted.researchId)),
      ).toMatchObject({ state: { kind: 'failed' }, draft: null });
      value(await handler(ownerId, accepted.jobId));
      expect(
        value(await research.get(ownerId, accepted.researchId)),
      ).toMatchObject({ state: { kind: 'succeeded' }, draft, notes: [] });
      value(await handler(ownerId, accepted.jobId));
      expect({ searches, drafts }).toEqual({ searches: 1, drafts: 2 });
      await database.close();
      const reopened = createDatabase({ url: databaseUrl });
      try {
        const snapshot = value(
          await createTransactionPort(reopened.db).run(
            ownerId,
            async (unit) => ({
              success: true,
              data: await unit.research.getRetrievalSnapshot(
                accepted.researchId,
              ),
            }),
          ),
        );
        expect(snapshot).toMatchObject({
          index: {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: 'lexical-v1',
          },
          citations: [],
          text: [],
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should submit research, adopt its draft and save a reference through HTTP', async () => {
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
      createResearchRoutes(createResearchService(transaction, clock, ids), {
        query: async () => {
          throw new Error('Unexpected image request');
        },
      }),
    );
    const post = async (path: string, input: unknown): Promise<Response> =>
      app.request(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      });
    try {
      const accepted = await post('/v1/research', researchInput());
      expect(accepted.status).toBe(202);
      const queued = (await accepted.json()) as { researchId: string };
      expect(
        await (await app.request(`/v1/research/${queued.researchId}`)).json(),
      ).toMatchObject({ state: { kind: 'queued' }, draft: null });
      const note = await noteInput(transaction, ownerId);
      const saved = await post('/v1/notes', note);
      expect(saved.status).toBe(201);
      expect(await saved.json()).toMatchObject({
        savedBy: 'collector',
        paragraphs: note.paragraphs,
        citations: note.citations,
      });
      const reference = await referenceInput(transaction, ownerId);
      const linked = await post('/v1/references', reference);
      expect(linked.status).toBe(201);
      const item = await linked.json();
      const listed = await app.request(
        `/v1/records/${reference.target.recordId}/references?limit=1`,
      );
      expect(listed.status).toBe(200);
      expect(await listed.json()).toMatchObject({ items: [item] });
    } finally {
      await database.close();
    }
  });

  it('should reject an inaccessible image anchor before calling retrieval providers', async () => {
    const database = createDatabase({ url: databaseUrl });
    const unavailable = async (): Promise<never> => {
      throw new Error('Unauthorized provider access');
    };
    try {
      const service = createImageSearchService({
        transaction: createTransactionPort(database.db),
        images: { search: unavailable, compare: unavailable },
        index: {
          embeddingModelId: 'test',
          dimensions: 3,
          indexVersion: randomUUID(),
        },
        clock,
        ids,
      });
      expect(
        await service.query(randomUUID(), {
          mode: 'search',
          queryAnchorId: randomUUID(),
          includeWholeImage: false,
          scope: 'my_collection',
          filters: {},
          limit: 10,
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    } finally {
      await database.close();
    }
  });

  it('should forward an owned image query and reject inaccessible comparison subjects', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    try {
      const input = await referenceInput(transaction, ownerId);
      if (input.reference.kind !== 'collection') {
        throw new Error('Expected collection fixture');
      }
      const selected = {
        kind: input.reference.kind,
        recordId: input.reference.recordId,
        originalAssetId: input.reference.originalAssetId,
      };
      const anchorId = randomUUID();
      const viewId = randomUUID();
      const derivativeId = randomUUID();
      value(
        await transaction.run(ownerId, async (unit) => {
          await unit.media.addDerivative({
            id: derivativeId,
            originalAssetId: selected.originalAssetId,
            parentDerivativeId: null,
            kind: 'canonical',
            storageKey: `tests/${derivativeId}`,
            mimeType: 'image/jpeg',
            byteLength: 12,
            sha256: 'ab'.repeat(32),
            region: null,
            transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          });
          await unit.media.addCanonicalView({
            id: viewId,
            originalAssetId: selected.originalAssetId,
            derivativeId,
            width: 20,
            height: 20,
            originalCoordinateSpace: 'image_pixels',
            transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          });
          await unit.evidence.addAnchor({
            id: anchorId,
            kind: 'image',
            recordId: selected.recordId,
            componentIds: [],
            originalAssetId: selected.originalAssetId,
            canonicalViewId: viewId,
            scope: { kind: 'whole' },
            createdAt: clock.now(),
          });

          return { success: true, data: undefined };
        }),
      );
      const index = {
        embeddingModelId: 'test',
        dimensions: 3,
        indexVersion: randomUUID(),
      };
      const query = {
        mode: 'search' as const,
        queryAnchorId: anchorId,
        includeWholeImage: false,
        scope: 'my_collection' as const,
        filters: {},
        limit: 10,
      };
      let received: unknown;
      const service = createImageSearchService({
        transaction,
        images: {
          search: async (request, space) => {
            received = { request, space };

            return {
              success: false,
              error: {
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Offline',
                retryable: true,
              },
            };
          },
          compare: async () => {
            throw new Error('Unauthorized comparison');
          },
        },
        index,
        clock,
        ids,
      });
      expect(await service.query(ownerId, query)).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
      });
      expect(received).toEqual({ request: query, space: index });
      expect(
        await service.query(ownerId, {
          mode: 'compare',
          queryAnchorId: anchorId,
          selected: {
            kind: 'collection',
            recordId: randomUUID(),
            originalAssetId: selected.originalAssetId,
          },
          selectedRegion: null,
          selectedCanonicalViewId: null,
        }),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
      expect(
        await service.query(ownerId, {
          mode: 'compare',
          queryAnchorId: anchorId,
          selected: {
            kind: 'reference',
            sourceVersionId: randomUUID(),
            referenceImageId: randomUUID(),
          },
          selectedRegion: null,
          selectedCanonicalViewId: null,
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      const sourceId = randomUUID();
      const sourceVersionId = randomUUID();
      const url = 'https://museum.example/catalogue/original';
      const metadata = {
        title: '館藏原始記錄',
        contributors: [],
        authorStatus: 'unknown' as const,
        editionStatement: null,
        publisher: null,
        publicationDateAsPrinted: null,
        isbn: null,
        languages: ['zh-Hant'],
        canonicalUrl: url,
        access: 'link_only' as const,
        rightsStatement: null,
        attributionText: null,
      };
      value(
        await transaction.run(ownerId, async (unit) => {
          await unit.sources.create(
            {
              id: sourceId,
              revision: 1,
              createdAt: clock.now(),
              updatedAt: clock.now(),
              kind: 'web',
              metadata,
              currentVersionId: sourceVersionId,
            },
            {
              id: sourceVersionId,
              sourceId,
              originalAssetIds: [],
              sourceHash: randomUUID(),
              metadataSnapshot: metadata,
              capturedAt: clock.now(),
              retrievedAt: clock.now(),
              status: 'ready',
              textIndexStatus: 'ready',
              imageIndexStatus: 'partial',
              activeParseRunId: null,
            },
            [],
          );

          return { success: true, data: undefined };
        }),
      );
      const locator = {
        kind: 'web' as const,
        sourceId,
        sourceVersionId,
        url,
        retrievedAt: clock.now(),
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      };
      const referenceImageId = randomUUID();
      const compared: unknown[] = [];
      const referenceTransaction: TransactionPort = {
        run: async (owner, operation) =>
          transaction.run(owner, async (unit) =>
            operation({
              ...unit,
              sources: {
                ...unit.sources,
                get: async (...args) => {
                  const detail = await unit.sources.get(...args);

                  return detail
                    ? {
                        ...detail,
                        referenceImages: [
                          {
                            id: referenceImageId,
                            sourceVersionId,
                            locator,
                            figureRegionId: null,
                            storedDerivativeId: null,
                            externalImageUrl:
                              'https://museum.example/image.jpg',
                            originalCaption: null,
                            generatedDescriptionZhHant: null,
                            descriptionJobId: null,
                            captionAssociation: 'none',
                          },
                        ],
                      }
                    : null;
                },
              },
            }),
          ),
      };
      const references = createImageSearchService({
        transaction: referenceTransaction,
        images: {
          search: async () => {
            throw new Error('Unexpected search');
          },
          compare: async (request) => {
            compared.push(request);

            return {
              success: false,
              error: {
                code: 'PROVIDER_UNAVAILABLE',
                message: 'Offline',
                retryable: true,
              },
              audit: { invocation: null, rawOutput: null },
            };
          },
        },
        index,
        clock,
        ids,
      });
      const referenceRequest = {
        mode: 'compare' as const,
        queryAnchorId: anchorId,
        selected: {
          kind: 'reference' as const,
          sourceVersionId,
          referenceImageId,
        },
        selectedRegion: null,
        selectedCanonicalViewId: null,
      };
      expect(
        await references.query(ownerId, {
          ...referenceRequest,
          selected: {
            ...referenceRequest.selected,
            referenceImageId: randomUUID(),
          },
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
      expect(compared).toEqual([]);
      expect(await references.query(ownerId, referenceRequest)).toMatchObject({
        success: false,
        error: { code: 'PROVIDER_UNAVAILABLE' },
      });
      expect(compared).toEqual([referenceRequest]);
    } finally {
      await database.close();
    }
  });

  it.each(['success', 'failure'] as const)(
    'should report persistence failure when comparison provider returns %s',
    async (outcome) => {
      const database = createDatabase({ url: databaseUrl });
      const ownerId = randomUUID();
      const transaction = createTransactionPort(database.db);
      try {
        const input = await referenceInput(transaction, ownerId);
        if (input.reference.kind !== 'collection') {
          throw new Error('Expected collection fixture');
        }
        const selected = {
          kind: input.reference.kind,
          recordId: input.reference.recordId,
          originalAssetId: input.reference.originalAssetId,
        };
        const anchorId = randomUUID();
        const viewId = randomUUID();
        const derivativeId = randomUUID();
        value(
          await transaction.run(ownerId, async (unit) => {
            await unit.media.addDerivative({
              id: derivativeId,
              originalAssetId: selected.originalAssetId,
              parentDerivativeId: null,
              kind: 'canonical',
              storageKey: `tests/${derivativeId}`,
              mimeType: 'image/jpeg',
              byteLength: 12,
              sha256: 'ab'.repeat(32),
              region: null,
              transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            });
            await unit.media.addCanonicalView({
              id: viewId,
              originalAssetId: selected.originalAssetId,
              derivativeId,
              width: 20,
              height: 20,
              originalCoordinateSpace: 'image_pixels',
              transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
            });
            await unit.evidence.addAnchor({
              id: anchorId,
              kind: 'image',
              recordId: selected.recordId,
              componentIds: [],
              originalAssetId: selected.originalAssetId,
              canonicalViewId: viewId,
              scope: { kind: 'whole' },
              createdAt: clock.now(),
            });

            return { success: true, data: undefined };
          }),
        );
        const index = {
          embeddingModelId: 'test',
          dimensions: 3,
          indexVersion: randomUUID(),
        };
        const request = {
          mode: 'compare' as const,
          queryAnchorId: anchorId,
          selected,
          selectedRegion: null,
          selectedCanonicalViewId: null,
        };
        const persistenceFailure = {
          success: false as const,
          error: {
            code: 'PROVIDER_UNAVAILABLE' as const,
            message: 'Comparison receipt storage unavailable',
            retryable: true,
          },
        };
        const run = vi
          .fn<TransactionPort['run']>()
          .mockResolvedValue(persistenceFailure)
          .mockImplementationOnce(transaction.run);
        const build = (port: TransactionPort) =>
          createImageSearchService({
            transaction: port,
            images: {
              search: async () => {
                throw new Error('Unexpected search');
              },
              compare: async () =>
                outcome === 'success'
                  ? {
                      success: true,
                      data: {
                        value: {
                          comparisonId: randomUUID(),
                          queryAnchorId: anchorId,
                          selected,
                          selectedRegion: null,
                          selectedCanonicalViewId: null,
                          similaritiesZhHant: ['相近'],
                          differencesZhHant: [],
                          limitsZhHant: ['僅為視覺比較'],
                          citations: [],
                        },
                        invocation: null,
                      },
                    }
                  : {
                      success: false,
                      error: {
                        code: 'MODEL_OUTPUT_INVALID',
                        message: 'Rejected model output',
                        retryable: false,
                      },
                      audit: { invocation: null, rawOutput: null },
                    },
            },
            index,
            clock,
            ids,
          });
        expect(
          await build({ run: run as TransactionPort['run'] }).query(
            ownerId,
            request,
          ),
        ).toEqual(persistenceFailure);
        expect(run).toHaveBeenCalledTimes(2);
        let audit: unknown;
        const observed: TransactionPort = {
          run: async (owner, operation) =>
            transaction.run(owner, async (unit) =>
              operation({
                ...unit,
                comparisons: {
                  ...unit.comparisons,
                  recordFailure: async (failure) => {
                    await unit.comparisons.recordFailure(failure);
                    audit = failure;
                  },
                },
              }),
            ),
        };
        const persisted = await build(observed).query(ownerId, request);
        if (outcome === 'success') {
          expect(persisted.success).toBe(true);
          if (!persisted.success || !('value' in persisted.data)) {
            throw new Error('Expected comparison envelope');
          }
          const comparison = persisted.data;
          const saved = value(
            await transaction.run(ownerId, async (unit) => ({
              success: true,
              data: await unit.comparisons.get(comparison.value.comparisonId),
            })),
          );
          expect(saved).toEqual(persisted.data);
        } else {
          expect(persisted).toMatchObject({
            success: false,
            error: { code: 'MODEL_OUTPUT_INVALID' },
          });
          expect(audit).toMatchObject({
            query: request,
            audit: { invocation: null, rawOutput: null },
            error: { code: 'MODEL_OUTPUT_INVALID' },
            createdAt: clock.now(),
          });
        }
      } finally {
        await database.close();
      }
    },
  );

  it('should persist model selection failure for an explicit research retry', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const research = createResearchService(transaction, clock, ids);
    const unavailable = async (): Promise<never> => {
      throw new Error('Provider must not run before model selection');
    };
    try {
      const accepted = value(await research.submit(ownerId, researchInput()));
      const handler = createResearchHandler({
        transaction,
        clock,
        ids,
        text: { snapshot: unavailable, search: unavailable },
        web: { search: unavailable },
        model: { draft: unavailable },
        catalog: {
          resolve: async () => ({
            success: false,
            error: {
              code: 'MODEL_UNKNOWN',
              message: 'Unknown model',
              retryable: false,
            },
          }),
        },
        index: {
          embeddingModelId: 'test',
          dimensions: 3,
          indexVersion: randomUUID(),
        },
        selection: {
          role: 'research',
          modelId: 'missing',
          profileVersion: 'v1',
        },
      });
      expect(await handler(ownerId, accepted.jobId)).toMatchObject({
        success: false,
        error: { code: 'MODEL_UNKNOWN' },
      });
      expect(
        value(await research.get(ownerId, accepted.researchId)),
      ).toMatchObject({
        state: { kind: 'failed', error: { code: 'MODEL_UNKNOWN' } },
        draft: null,
      });
      expect(await handler(ownerId, randomUUID())).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
    } finally {
      await database.close();
    }
  });

  it('should reject an empty instruction and an out-of-bounds reference crop before persisting work', async () => {
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
      createResearchRoutes(createResearchService(transaction, clock, ids), {
        query: async () => {
          throw new Error('Image search is outside this scenario');
        },
      }),
    );
    try {
      const empty = await app.request('/v1/research', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...researchInput(), instructionZhHant: '  ' }),
      });
      expect(empty.status).toBe(422);
      const input = await referenceInput(transaction, ownerId);
      const invalid = await app.request('/v1/references', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...input,
          reference: {
            kind: 'source',
            referenceImageId: null,
            locator: {
              kind: 'page',
              sourceId: randomUUID(),
              sourceVersionId: randomUUID(),
              pageId: randomUUID(),
              pageIndex: 0,
              printedPageLabel: null,
              canonicalViewId: randomUUID(),
              regionId: null,
              textRange: null,
              region: { kind: 'rect', x: 0.9, y: 0, width: 0.2, height: 1 },
            },
          },
        }),
      });
      expect(invalid.status).toBe(422);
      expect(await invalid.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
    } finally {
      await database.close();
    }
  });
});

function researchInput(): ResearchRequest {
  return {
    requestKey: randomUUID(),
    instructionZhHant: '比較此類釉面特徵並列明資料不足之處',
    scope: 'curated_and_public_web',
    recordId: null,
    entryId: null,
    sourceIds: [],
    preferNamedAuthors: true,
  };
}

async function noteInput(
  transaction: TransactionPort,
  ownerId: string,
): Promise<NoteInput> {
  const research = createResearchService(transaction, clock, ids);
  const accepted = value(await research.submit(ownerId, researchInput()));
  const citation: NoteInput['citations'][number] = {
    id: randomUUID(),
    locator: {
      kind: 'web',
      sourceId: randomUUID(),
      sourceVersionId: randomUUID(),
      url: 'https://museum.example/catalogue',
      retrievedAt: clock.now(),
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: '館藏記錄中的釉面描述',
    },
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
  };
  const input: NoteInput = {
    requestKey: randomUUID(),
    researchId: accepted.researchId,
    expectedDraftRevision: 1,
    titleZhHant: '釉面研究筆記',
    paragraphs: [
      {
        textZhHant: '與館藏描述比較',
        support: 'cited',
        citationIds: [citation.id],
      },
    ],
    citations: [citation],
    recordId: null,
    entryId: null,
  };
  value(
    await transaction.run(ownerId, async (unit) => {
      const detail = await unit.research.get(accepted.researchId);
      if (!detail) {
        throw new Error('Research fixture not persisted');
      }
      await unit.research.saveDetail({
        ...detail,
        state: { kind: 'succeeded', completedAt: clock.now() },
        draft: {
          revision: 1,
          titleZhHant: input.titleZhHant,
          paragraphs: input.paragraphs,
          citations: input.citations,
          unresolvedQuestionsZhHant: [],
        },
      });

      return { success: true, data: undefined };
    }),
  );

  return input;
}

async function referenceInput(
  transaction: TransactionPort,
  ownerId: string,
): Promise<ReferenceInput> {
  const records = createRecordService(transaction, clock, ids);
  const target = value(
    await records.create(ownerId, randomUUID(), {
      unitKind: 'single',
      name: '研究對象',
    }),
  );
  const source = value(
    await records.create(ownerId, randomUUID(), {
      unitKind: 'single',
      name: '比較藏品',
    }),
  );
  const assetId = randomUUID();
  value(
    await transaction.run(ownerId, async (unit) => {
      await unit.media.createUpload(
        {
          requestKey: randomUUID(),
          target: { kind: 'record', recordId: source.id },
          kind: 'photo',
          purpose: 'object',
          componentIds: [],
          fileName: 'comparison.jpg',
          mimeType: 'image/jpeg',
          byteLength: 12,
          sha256: 'ab'.repeat(32),
        },
        {
          assetId,
          mode: 'single',
          putUrl: 'https://storage.example/upload',
          headers: {},
          expiresAt: '2026-10-14T00:00:00.000Z',
        },
      );
      await unit.media.complete(assetId, {
        assetId,
        state: 'uploaded',
        processingJobId: null,
      });
      await unit.media.markReadyOnce(assetId, 'uploaded');

      return { success: true, data: undefined };
    }),
  );

  return {
    requestKey: randomUUID(),
    expectedRecordRevision: 1,
    target: {
      recordId: target.id,
      checkId: null,
      observationId: null,
      evidenceAnchorId: null,
    },
    reference: {
      kind: 'collection',
      recordId: source.id,
      originalAssetId: assetId,
      evidenceAnchorId: null,
    },
    comparisonId: null,
    noteZhHant: '釉面可供比較，不代表年代鑑定',
  };
}

function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
