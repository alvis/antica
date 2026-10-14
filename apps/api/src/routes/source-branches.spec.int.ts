import { randomUUID } from 'node:crypto';

import { describe, expect, inject, vi } from 'vitest';

import {
  createKnowledgeService,
  createSourceService,
  createSourceIngestionHandler,
} from '@antica/application/server';

import { createHttpTest } from '../fixtures/http/test.js';

import { knowledgeInput } from '../fixtures/knowledge.js';
import { sourceInput } from '../fixtures/source.js';

import type {
  DurableSourceParsingPort,
  DurableTextIndexWriterPort,
  OperationResult,
  TextIndexWriterPort,
  TransactionPort,
  UnitOfWork,
} from '@antica/application/ports';
import type {
  SourceImageIndexPort,
  SourceService,
} from '@antica/application/server';
import type { SourceCommand } from '@antica/contracts';

const resources = inject('httpResources');
const it = createHttpTest(resources['routes/source-branches']!);

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };
type Registration = Extract<
  SourceCommand,
  { mode: 'register' }
>['registration'];
const invalid: ReadonlyArray<{
  name: string;
  change: (input: Registration) => Registration;
  code: string;
}> = [
  {
    name: 'empty pages',
    change: (input) => ({ ...input, assets: [] }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'noncontiguous pages',
    change: (input) => ({
      ...input,
      assets: [{ ...input.assets[0]!, order: 1 }],
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'repeated assets',
    change: (input) => ({
      ...input,
      assets: [input.assets[0]!, { ...input.assets[0]!, order: 1 }],
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'multi-asset PDF',
    change: (input) => ({
      ...input,
      kind: 'book_pdf',
      assets: [
        input.assets[0]!,
        { ...input.assets[0]!, assetId: randomUUID(), order: 1 },
      ],
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'unknown named author',
    change: (input) => ({
      ...input,
      metadata: {
        ...input.metadata,
        contributors: [
          { nameAsPrinted: '作者', role: 'author', attribution: 'as_printed' },
        ],
      },
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'missing upload',
    change: (input) => ({
      ...input,
      assets: [{ ...input.assets[0]!, assetId: randomUUID() }],
    }),
    code: 'FORBIDDEN',
  },
  {
    name: 'different intake',
    change: (input) => ({ ...input, intakeKey: randomUUID() }),
    code: 'FORBIDDEN',
  },
  {
    name: 'image registered as PDF',
    change: (input) => ({ ...input, kind: 'book_pdf' }),
    code: 'MEDIA_UNSUPPORTED',
  },
  {
    name: 'inaccessible existing source',
    change: (input) => ({
      ...input,
      existingSourceId: randomUUID(),
      expectedRevision: 1,
    }),
    code: 'NOT_FOUND',
  },
];

describe('Source registration boundaries', () => {
  it.for(invalid)(
    'should reject $name and allow correction with the same request key',
    async ({ change, code }, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          expect(
            await service.submit(ownerId, {
              ...input,
              registration: change(input.registration),
            }),
          ).toMatchObject({ success: false, error: { code } });
          expect(await service.submit(ownerId, input)).toMatchObject({
            success: true,
          });
        },
      );
    },
  );

  it('should reject a PDF asset presented as a page image', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service }) => {
        const input = await sourceInput(transaction, ownerId, {
          document: true,
        });
        expect(
          await service.submit(ownerId, {
            ...input,
            registration: { ...input.registration, kind: 'book_pages' },
          }),
        ).toMatchObject({
          success: false,
          error: { code: 'MEDIA_UNSUPPORTED' },
        });
      },
    );
  });

  it('should reject duplicate content whose ingestion job is unavailable', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service, withRepository }) => {
        const input = await sourceInput(transaction, ownerId);
        const accepted = value(await service.submit(ownerId, input));
        const version = value(
          await service.get({ ownerId, id: accepted.sourceId }),
        ).version;
        const unavailable = withRepository({
          findVersionByHash: async () => version,
          getIngestionJobId: async () => null,
        });
        expect(
          await unavailable.submit(
            ownerId,
            await sourceInput(transaction, ownerId),
          ),
        ).toMatchObject({
          success: false,
          error: { code: 'SOURCE_UNAVAILABLE' },
        });
        expect(
          value(await service.get({ ownerId, id: accepted.sourceId })).source
            .revision,
        ).toBe(1);
      },
    );
  });

  it('should replay deduplicated intake receipts and reject an inconsistent reprocess source', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service, withRepository }) => {
        const original = value(
          await service.submit(
            ownerId,
            await sourceInput(transaction, ownerId),
          ),
        );
        const version = value(
          await service.get({ ownerId, id: original.sourceId }),
        ).version;
        const duplicate = withRepository({
          findVersionByHash: async () => version,
        });
        const input = await sourceInput(transaction, ownerId);
        expect(value(await duplicate.submit(ownerId, input))).toEqual(original);
        expect(value(await duplicate.submit(ownerId, input))).toEqual(original);
        expect(
          await withRepository({ get: async () => null }).submit(ownerId, {
            mode: 'reprocess',
            requestKey: randomUUID(),
            sourceVersionId: version.id,
            pageIds: [randomUUID()],
          }),
        ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      },
    );
  });

  it.for(['revision', 'kind', 'compare-and-swap'] as const)(
    'should preserve the source when registration loses the %s check',
    async (scenario, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service, withRepository }) => {
          const original = value(
            await service.submit(
              ownerId,
              await sourceInput(transaction, ownerId),
            ),
          );
          const next = await sourceInput(transaction, ownerId, {
            document: scenario === 'kind',
          });
          const updating =
            scenario === 'compare-and-swap'
              ? withRepository({ addVersion: async () => false })
              : service;
          expect(
            await updating.submit(ownerId, {
              ...next,
              registration: {
                ...next.registration,
                existingSourceId: original.sourceId,
                expectedRevision: scenario === 'revision' ? 2 : 1,
              },
            }),
          ).toMatchObject({
            success: false,
            error: { code: 'REVISION_CONFLICT', retryable: true },
          });
          expect(
            value(await service.get({ ownerId, id: original.sourceId })).version
              .id,
          ).toBe(original.sourceVersionId);
        },
      );
    },
  );

  it('should reject missing reprocess versions and incompatible page selectors', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service }) => {
        expect(
          await service.submit(ownerId, {
            mode: 'reprocess',
            requestKey: randomUUID(),
            sourceVersionId: randomUUID(),
            pageIds: [randomUUID()],
          }),
        ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
        const original = value(
          await service.submit(
            ownerId,
            await sourceInput(transaction, ownerId),
          ),
        );
        expect(
          await service.get({
            ownerId,
            id: original.sourceId,
            versionId: original.sourceVersionId,
            pageId: randomUUID(),
            cursor: 'cursor',
          }),
        ).toMatchObject({
          success: false,
          error: { code: 'VALIDATION_FAILED' },
        });
        for (const pageIds of [
          [],
          [randomUUID()],
          ['duplicate', 'duplicate'],
        ]) {
          expect(
            await service.submit(ownerId, {
              mode: 'reprocess',
              requestKey: randomUUID(),
              sourceVersionId: original.sourceVersionId,
              pageIds,
            }),
          ).toMatchObject({
            success: false,
            error: {
              code:
                pageIds.length === 1
                  ? 'SOURCE_UNAVAILABLE'
                  : 'VALIDATION_FAILED',
            },
          });
        }
      },
    );
  });
});

describe('Durable source ingestion checkpoints', () => {
  it.for([
    { operation: 'getJob', call: 1, code: 'NOT_FOUND' },
    { operation: 'getVersion', call: 1, code: 'NOT_FOUND' },
    { operation: 'getSource', call: 1, code: 'NOT_FOUND' },
    { operation: 'updateVersion', call: 1, code: 'REVISION_CONFLICT' },
    { operation: 'updateJob', call: 1, code: 'REVISION_CONFLICT' },
    { operation: 'getJob', call: 2, code: 'NOT_FOUND' },
    { operation: 'getVersion', call: 2, code: 'NOT_FOUND' },
    { operation: 'updateStep', call: 1, code: 'REVISION_CONFLICT' },
    { operation: 'updateJob', call: 2, code: 'REVISION_CONFLICT' },
    { operation: 'getJob', call: 3, code: 'NOT_FOUND' },
    { operation: 'getVersion', call: 3, code: 'NOT_FOUND' },
    { operation: 'updateVersion', call: 2, code: 'REVISION_CONFLICT' },
    { operation: 'updateJob', call: 3, code: 'REVISION_CONFLICT' },
  ])(
    'should surface $operation failure at lifecycle call $call',
    async (fault, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          const accepted = value(await service.submit(ownerId, input));
          const counts = new Map<string, number>();
          const fails = (operation: string): boolean => {
            const count = (counts.get(operation) ?? 0) + 1;
            counts.set(operation, count);

            return operation === fault.operation && count === fault.call;
          };
          const interrupted: TransactionPort = {
            run: async (owner, operation) =>
              transaction.run(owner, async (unit) =>
                operation({
                  ...unit,
                  sources: {
                    ...unit.sources,
                    getVersion: async (...args) =>
                      fails('getVersion')
                        ? null
                        : unit.sources.getVersion(...args),
                    get: async (...args) =>
                      fails('getSource') ? null : unit.sources.get(...args),
                    updateVersion: async (...args) =>
                      fails('updateVersion')
                        ? false
                        : unit.sources.updateVersion(...args),
                  },
                  jobs: {
                    ...unit.jobs,
                    get: async (...args) =>
                      fails('getJob') ? null : unit.jobs.get(...args),
                    update: async (...args) =>
                      fails('updateJob') ? false : unit.jobs.update(...args),
                    updateStep: async (...args) =>
                      fails('updateStep')
                        ? false
                        : unit.jobs.updateStep(...args),
                  },
                }),
              ),
          };
          const handler = createSourceIngestionHandler({
            transaction: interrupted,
            parser: {
              parse: async () => ({
                success: true,
                data: {
                  sourceVersionId: accepted.sourceVersionId,
                  parseRunId: accepted.jobId,
                  rawOutputAssetId: input.registration.assets[0]!.assetId,
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
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: false,
            error: { code: fault.code },
          });
          expect(
            value(await service.get({ ownerId, id: accepted.sourceId })).version
              .status,
          ).not.toBe('ready');
        },
      );
    },
  );

  it.for(['text failure', 'image failure', 'partial', 'complete'] as const)(
    'should retain parsed work across external indexing: %s',
    async (scenario, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          const accepted = value(await service.submit(ownerId, input));
          let parses = 0;
          const unavailable = {
            success: false as const,
            error: {
              code: 'PROVIDER_UNAVAILABLE' as const,
              message: 'Index unavailable',
              retryable: true,
            },
          };
          const indexSource = vi.fn<TextIndexWriterPort['indexSource']>(
            async () => ({
              success: true,
              data: { indexedCount: 0, mappings: [] },
            }),
          );
          const indexImage = vi.fn<SourceImageIndexPort['index']>(async () => ({
            success: true,
            data: { indexedCount: 0 },
          }));
          if (scenario === 'text failure') {
            indexSource.mockResolvedValueOnce(unavailable);
          }
          if (scenario === 'image failure') {
            indexImage.mockResolvedValueOnce(unavailable);
          }
          const handler = createSourceIngestionHandler({
            transaction,
            parser: {
              parse: async () => {
                parses++;

                return {
                  success: true,
                  data: {
                    sourceVersionId: accepted.sourceVersionId,
                    parseRunId: accepted.jobId,
                    rawOutputAssetId: input.registration.assets[0]!.assetId,
                    pages: [],
                    regions: [],
                    images: [],
                    warnings:
                      scenario === 'partial'
                        ? [{ pageId: null, messageZhHant: '來源需核對' }]
                        : [],
                  },
                };
              },
            },
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
                writer: {
                  indexSource,
                },
              },
              image: {
                kind: 'external',
                writer: {
                  index: indexImage,
                },
              },
            },
          });
          const result = await handler(ownerId, accepted.jobId);
          if (scenario.endsWith('failure')) {
            expect(result).toEqual(unavailable);
            expect(await handler(ownerId, accepted.jobId)).toMatchObject({
              success: true,
            });
          } else {
            expect(result).toMatchObject({ success: true });
          }
          expect(parses).toBe(1);
          expect(
            value(await service.get({ ownerId, id: accepted.sourceId }))
              .version,
          ).toMatchObject({
            status: scenario === 'partial' ? 'partial' : 'ready',
            textIndexStatus: scenario === 'partial' ? 'partial' : 'ready',
            imageIndexStatus: scenario === 'partial' ? 'partial' : 'ready',
          });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: true,
          });
          expect(parses).toBe(1);
        },
      );
    },
  );

  it.for([
    'completed parse',
    'invalid completed parse',
    'parse provider failure',
    'parse checkpoint conflict',
    'parse job missing',
    'parse job conflict',
    'index checkpoint conflict',
    'index job missing',
    'index job conflict',
    'index provider failure',
  ] as const)(
    'should handle durable checkpoint boundary: %s',
    async (scenario, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          const accepted = value(await service.submit(ownerId, input));
          const pack = {
            sourceVersionId: accepted.sourceVersionId,
            parseRunId: accepted.jobId,
            rawOutputAssetId: input.registration.assets[0]!.assetId,
            pages: [],
            regions: [],
            images: [],
            warnings: [],
          };
          const parseStep = `parse:${input.registration.assets[0]!.assetId}`;
          if (scenario.includes('completed parse')) {
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.updateStep(
                  {
                    jobId: accepted.jobId,
                    step: parseStep,
                    revision: 1,
                    state: 'completed',
                    leaseUntil: null,
                    checkpoint: null,
                    result:
                      scenario === 'completed parse' ? pack : { pages: [] },
                  },
                  0,
                ),
              })),
            );
          }
          let jobReads = 0;
          let jobUpdates = 0;
          const interrupted: TransactionPort = {
            run: async (owner, operation) =>
              transaction.run(owner, async (unit) =>
                operation({
                  ...unit,
                  jobs: {
                    ...unit.jobs,
                    get: async (...args) => {
                      jobReads++;

                      return (scenario === 'parse job missing' &&
                        jobReads === 2) ||
                        (scenario === 'index job missing' && jobReads === 4)
                        ? null
                        : unit.jobs.get(...args);
                    },
                    update: async (...args) => {
                      jobUpdates++;

                      return (scenario === 'parse job conflict' &&
                        jobUpdates === 2) ||
                        (scenario === 'index job conflict' && jobUpdates === 4)
                        ? false
                        : unit.jobs.update(...args);
                    },
                    updateStep: async (...args) =>
                      (scenario === 'parse checkpoint conflict' &&
                        args[0].step === parseStep) ||
                      (scenario === 'index checkpoint conflict' &&
                        args[0].step === 'index:text')
                        ? false
                        : unit.jobs.updateStep(...args),
                  },
                }),
              ),
          };
          const unavailable = {
            success: false as const,
            error: {
              code: 'PROVIDER_UNAVAILABLE' as const,
              message: 'Unavailable',
              retryable: true,
            },
          };
          const parser: DurableSourceParsingPort = {
            submit: async () =>
              scenario === 'parse provider failure'
                ? unavailable
                : { success: true, data: { kind: 'completed', pack } },
            resume: async () => {
              throw new Error('No waiting parse');
            },
          };
          const writer: DurableTextIndexWriterPort = {
            submit: async () =>
              scenario === 'index provider failure'
                ? unavailable
                : {
                    success: true,
                    data: { kind: 'completed', indexedCount: 0, mappings: [] },
                  },
            resume: async () => {
              throw new Error('No waiting index');
            },
          };
          let imageAttempts = 0;
          const handler = createSourceIngestionHandler({
            transaction: interrupted,
            parser,
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
                writer,
              },
              image: {
                kind: 'external',
                writer: {
                  index: async () =>
                    scenario === 'completed parse' && imageAttempts++ === 0
                      ? unavailable
                      : { success: true, data: { indexedCount: 0 } },
                },
              },
            },
          });
          const result = await handler(ownerId, accepted.jobId);
          if (scenario === 'completed parse') {
            expect(result).toEqual(unavailable);
            expect(await handler(ownerId, accepted.jobId)).toMatchObject({
              success: true,
            });
            expect(
              value(await service.get({ ownerId, id: accepted.sourceId }))
                .version.status,
            ).toBe('ready');
          } else {
            expect(result).toMatchObject({
              success: false,
              error: {
                code: scenario.includes('provider failure')
                  ? 'PROVIDER_UNAVAILABLE'
                  : scenario.includes('missing')
                    ? 'NOT_FOUND'
                    : scenario === 'invalid completed parse'
                      ? 'SOURCE_UNAVAILABLE'
                      : 'REVISION_CONFLICT',
              },
            });
            expect(
              value(await service.get({ ownerId, id: accepted.sourceId }))
                .version.status,
            ).not.toBe('ready');
          }
        },
      );
    },
  );

  it.for([
    'missing job',
    'job conflict',
    'version conflict',
    'missing version',
    'inactive version',
    'superseded version',
  ] as const)(
    'should report a failed parser error receipt: %s',
    async (scenario, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const accepted = value(
            await service.submit(
              ownerId,
              await sourceInput(transaction, ownerId),
            ),
          );
          let gets = 0;
          let updates = 0;
          let versions = 0;
          let versionReads = 0;
          const interrupted: TransactionPort = {
            run: async (owner, operation) =>
              transaction.run(owner, async (unit) =>
                operation({
                  ...unit,
                  jobs: {
                    ...unit.jobs,
                    get: async (...args) =>
                      scenario === 'missing job' && ++gets === 2
                        ? null
                        : unit.jobs.get(...args),
                    update: async (...args) =>
                      scenario === 'job conflict' && ++updates === 2
                        ? false
                        : unit.jobs.update(...args),
                  },
                  sources: {
                    ...unit.sources,
                    getVersion: async (...args) => {
                      const version = await unit.sources.getVersion(...args);
                      if (++versionReads !== 2) {
                        return version;
                      }
                      if (scenario === 'missing version') {
                        return null;
                      }

                      return version
                        ? {
                            ...version,
                            status:
                              scenario === 'inactive version'
                                ? 'ready'
                                : version.status,
                            activeParseRunId:
                              scenario === 'superseded version'
                                ? randomUUID()
                                : version.activeParseRunId,
                          }
                        : version;
                    },
                    updateVersion: async (...args) =>
                      scenario === 'version conflict' && ++versions === 2
                        ? false
                        : unit.sources.updateVersion(...args),
                  },
                }),
              ),
          };
          const handler = createSourceIngestionHandler({
            transaction: interrupted,
            parser: {
              parse: async () => ({
                success: false,
                error: {
                  code: 'PROVIDER_UNAVAILABLE',
                  message: 'Parser offline',
                  retryable: true,
                },
              }),
            },
            clock,
            ids,
          });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: false,
            error: {
              code: scenario.startsWith('missing')
                ? 'NOT_FOUND'
                : 'REVISION_CONFLICT',
            },
          });
          expect(
            value(await service.get({ ownerId, id: accepted.sourceId })).version
              .status,
          ).toBe('processing');
          expect(
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.get(accepted.jobId),
              })),
            ),
          ).toMatchObject({ state: { kind: 'running', stage: 'parsing' } });
        },
      );
    },
  );

  it.for([2, 3, 6])(
    'should propagate checkpoint transaction failure at boundary %s',
    async (failAt, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          const accepted = value(await service.submit(ownerId, input));
          const unavailable = {
            success: false as const,
            error: {
              code: 'PROVIDER_UNAVAILABLE' as const,
              message: 'Checkpoint store unavailable',
              retryable: true,
            },
          };
          let calls = 0;
          const run = vi
            .fn<TransactionPort['run']>()
            .mockImplementation(async (owner, operation) =>
              ++calls === failAt
                ? unavailable
                : transaction.run(owner, operation),
            );
          const parser: DurableSourceParsingPort = {
            submit: async () => ({
              success: true,
              data: {
                kind: 'completed',
                pack: {
                  sourceVersionId: accepted.sourceVersionId,
                  parseRunId: accepted.jobId,
                  rawOutputAssetId: input.registration.assets[0]!.assetId,
                  pages: [],
                  regions: [],
                  images: [],
                  warnings: [],
                },
              },
            }),
            resume: async () => {
              throw new Error('Unexpected resume');
            },
          };
          const handler = createSourceIngestionHandler({
            transaction: { run: run as TransactionPort['run'] },
            parser,
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
                writer: {
                  submit: async () => ({
                    success: true,
                    data: { kind: 'completed', indexedCount: 0, mappings: [] },
                  }),
                  resume: async () => {
                    throw new Error('Unexpected resume');
                  },
                },
              },
              image: { kind: 'local' },
            },
          });
          expect(await handler(ownerId, accepted.jobId)).toEqual(unavailable);
          expect(
            value(await service.get({ ownerId, id: accepted.sourceId })).version
              .status,
          ).not.toBe('ready');
        },
      );
    },
  );

  it('should preserve an existing draft association during ingestion', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service }) => {
        const input = await sourceInput(transaction, ownerId);
        const accepted = value(await service.submit(ownerId, input));
        const entry = value(
          await createKnowledgeService(transaction, clock, ids).create(
            ownerId,
            knowledgeInput(),
          ),
        );
        value(
          await transaction.run(ownerId, async (unit) => {
            await unit.sources.linkKnowledgeDraft(
              accepted.sourceVersionId,
              entry.entry.id,
            );

            return { success: true, data: undefined };
          }),
        );
        const handler = createSourceIngestionHandler({
          transaction,
          parser: {
            parse: async () => ({
              success: true,
              data: {
                sourceVersionId: accepted.sourceVersionId,
                parseRunId: accepted.jobId,
                rawOutputAssetId: input.registration.assets[0]!.assetId,
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
        expect(await handler(ownerId, accepted.jobId)).toMatchObject({
          success: true,
        });
        expect(
          value(await service.get({ ownerId, id: accepted.sourceId }))
            .knowledgeDraftIds,
        ).toEqual([entry.entry.id]);
      },
    );
  });

  it('should reject completion after another parser takes ownership of the source version', async ({
    fixture,
  }) => {
    await withSource(
      fixture.runtime.transaction,
      async ({ ownerId, transaction, service }) => {
        const input = await sourceInput(transaction, ownerId);
        const accepted = value(await service.submit(ownerId, input));
        let reads = 0;
        const interrupted: TransactionPort = {
          run: async (owner, operation) =>
            transaction.run(owner, async (unit) =>
              operation({
                ...unit,
                sources: {
                  ...unit.sources,
                  getVersion: async (...args) => {
                    const version = await unit.sources.getVersion(...args);

                    return ++reads === 3 && version
                      ? { ...version, activeParseRunId: randomUUID() }
                      : version;
                  },
                },
              }),
            ),
        };
        const handler = createSourceIngestionHandler({
          transaction: interrupted,
          parser: {
            parse: async () => ({
              success: true,
              data: {
                sourceVersionId: accepted.sourceVersionId,
                parseRunId: accepted.jobId,
                rawOutputAssetId: input.registration.assets[0]!.assetId,
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
        expect(await handler(ownerId, accepted.jobId)).toMatchObject({
          success: false,
          error: { code: 'REVISION_CONFLICT' },
        });
        expect(
          value(await service.get({ ownerId, id: accepted.sourceId })).version
            .status,
        ).toBe('processing');
      },
    );
  });

  it.for([true, false])(
    'should resume parsing and indexing from saved provider handles with delayed resume %s',
    async (delayed, { fixture }) => {
      await withSource(
        fixture.runtime.transaction,
        async ({ ownerId, transaction, service }) => {
          const input = await sourceInput(transaction, ownerId);
          const accepted = value(await service.submit(ownerId, input));
          const parserCalls: string[] = [];
          const textCalls: string[] = [];
          const parseHandle = {
            sourceVersionId: accepted.sourceVersionId,
            parseRunId: accepted.jobId,
            originalAssetId: input.registration.assets[0]!.assetId,
            provider: 'parser',
            providerJobId: randomUUID(),
          };
          const pack = {
            sourceVersionId: accepted.sourceVersionId,
            parseRunId: accepted.jobId,
            rawOutputAssetId: input.registration.assets[0]!.assetId,
            pages: [],
            regions: [],
            images: [],
            warnings: [],
          };
          const parser: DurableSourceParsingPort = {
            submit: async (request) => {
              parserCalls.push('submit');
              expect(request).toEqual({
                sourceVersionId: parseHandle.sourceVersionId,
                parseRunId: parseHandle.parseRunId,
                originalAssetId: parseHandle.originalAssetId,
              });

              return {
                success: true,
                data: {
                  kind: 'waiting',
                  ...parseHandle,
                  ...(delayed
                    ? { resumeAfter: '2026-10-13T00:01:00.000Z' }
                    : {}),
                },
              };
            },
            resume: async (handle) => {
              parserCalls.push('resume');
              expect(handle).toEqual(parseHandle);

              return { success: true, data: { kind: 'completed', pack } };
            },
          };
          const index = {
            embeddingModelId: 'test',
            dimensions: 3,
            indexVersion: randomUUID(),
          };
          const textHandle = {
            sourceVersionId: accepted.sourceVersionId,
            parseRunId: accepted.jobId,
            provider: 'text',
            providerJobId: randomUUID(),
            providerDocumentIds: ['document'],
            checkpointAssetId: randomUUID(),
            index,
          };
          const writer: DurableTextIndexWriterPort = {
            submit: async (request) => {
              textCalls.push('submit');
              expect(request).toEqual({
                sourceVersionId: accepted.sourceVersionId,
                parseRunId: accepted.jobId,
                chunks: [],
                index,
              });

              return {
                success: true,
                data: { kind: 'waiting', ...textHandle },
              };
            },
            resume: async (handle) => {
              textCalls.push('resume');
              expect(handle).toMatchObject(textHandle);

              return {
                success: true,
                data: { kind: 'completed', indexedCount: 0, mappings: [] },
              };
            },
          };
          const handler = createSourceIngestionHandler({
            transaction,
            parser,
            clock,
            ids,
            indexing: {
              text: { kind: 'external', index, writer },
              image: { kind: 'local' },
            },
          });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: true,
          });
          expect(
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.get(accepted.jobId),
              })),
            ),
          ).toMatchObject({ state: { kind: 'waiting', stage: 'parsing' } });
          expect(
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.getStep(
                  accepted.jobId,
                  `parse:${input.registration.assets[0]!.assetId}`,
                ),
              })),
            ),
          ).toMatchObject({
            state: 'waiting',
            leaseUntil: delayed ? '2026-10-13T00:01:00.000Z' : null,
          });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: true,
          });
          expect(
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.get(accepted.jobId),
              })),
            ),
          ).toMatchObject({ state: { kind: 'waiting', stage: 'text_index' } });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: true,
          });
          expect(
            value(await service.get({ ownerId, id: accepted.sourceId }))
              .version,
          ).toMatchObject({
            status: 'ready',
            textIndexStatus: 'ready',
            imageIndexStatus: 'ready',
          });
          expect(await handler(ownerId, accepted.jobId)).toMatchObject({
            success: true,
          });
          expect(
            value(
              await transaction.run(ownerId, async (unit) => ({
                success: true,
                data: await unit.jobs.getStep(
                  accepted.jobId,
                  `parse:${input.registration.assets[0]!.assetId}`,
                ),
              })),
            ),
          ).toMatchObject({ state: 'completed', leaseUntil: null });
          expect(parserCalls).toEqual(['submit', 'resume']);
          expect(textCalls).toEqual(['submit', 'resume']);
        },
      );
    },
  );
});

interface SourceContext {
  readonly ownerId: string;
  readonly transaction: TransactionPort;
  readonly service: SourceService;
  readonly withRepository: (
    overrides: Partial<UnitOfWork['sources']>,
  ) => SourceService;
}
async function withSource(
  transaction: TransactionPort,
  run: (context: SourceContext) => Promise<void>,
): Promise<void> {
  await run({
    ownerId: randomUUID(),
    transaction,
    service: createSourceService({
      transaction,
      clock,
      ids,
    }),
    withRepository: (overrides) =>
      createSourceService({
        transaction: {
          run: async (owner, operation) =>
            transaction.run(owner, async (unit) =>
              operation({
                ...unit,
                sources: { ...unit.sources, ...overrides },
              }),
            ),
        },
        clock,
        ids,
      }),
  });
}
function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
