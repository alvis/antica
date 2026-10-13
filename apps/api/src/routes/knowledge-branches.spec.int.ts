import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createKnowledgeService,
  createResearchService,
} from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';

import { knowledgeInput } from '../fixtures/knowledge.js';

import type {
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '@antica/application/ports';
import type { KnowledgeService } from '@antica/application/server';
import type { KnowledgeWrite } from '@antica/contracts';

type SourceCitation = KnowledgeWrite['content']['citations'][number];

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };
const invalidInputs: ReadonlyArray<{
  name: string;
  change: (input: KnowledgeWrite) => KnowledgeWrite;
  code: string;
}> = [
  {
    name: 'blank title',
    change: (input) => ({
      ...input,
      content: { ...input.content, titleZhHant: '  ' },
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'no knowledge kind',
    change: (input) => ({ ...input, content: { ...input.content, kinds: [] } }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'inaccessible originating research',
    change: (input) => ({ ...input, originResearchId: randomUUID() }),
    code: 'SOURCE_UNAVAILABLE',
  },
  {
    name: 'cited text without a citation',
    change: (input) => ({
      ...input,
      content: {
        ...input.content,
        summary: { textZhHant: '來源聲明', support: 'cited', citationIds: [] },
      },
    }),
    code: 'VALIDATION_FAILED',
  },
  {
    name: 'cited text with an unresolved identifier',
    change: (input) => ({
      ...input,
      content: {
        ...input.content,
        summary: {
          textZhHant: '來源聲明',
          support: 'cited',
          citationIds: [randomUUID()],
        },
      },
    }),
    code: 'VALIDATION_FAILED',
  },
];

describe('Knowledge validation and method revision boundaries', () => {
  it.each(invalidInputs)(
    'should reject $name before persisting an entry',
    async ({ change, code }) => {
      await withKnowledge(async ({ ownerId, knowledge }) => {
        expect(
          await knowledge.create(ownerId, change(knowledgeInput())),
        ).toMatchObject({ success: false, error: { code } });
        expect(value(await knowledge.list(ownerId, {})).items).toEqual([]);
      });
    },
  );

  it('should preserve a resolved citation across entry and method applicability sections', async () => {
    await withKnowledge(async ({ ownerId, transaction, knowledge }) => {
      const citation = await persistCitation(transaction, ownerId);
      const input = knowledgeInput();
      const research = value(
        await createResearchService(transaction, clock, ids).submit(ownerId, {
          requestKey: randomUUID(),
          instructionZhHant: '追溯來源',
          scope: 'curated_and_public_web',
          recordId: null,
          entryId: null,
          sourceIds: [],
          preferNamedAuthors: true,
        }),
      );
      const cited = {
        textZhHant: '可核對來源',
        support: 'cited' as const,
        citationIds: [citation.id],
      };
      const context = {
        scope: 'general' as const,
        objectTypeIds: [],
        materialIds: [],
        periodIds: [],
        regionIds: [],
        limits: cited,
      };
      const definition = input.methodWrites[0]!.definition;
      const saved = value(
        await knowledge.create(ownerId, {
          ...input,
          originResearchId: research.researchId,
          content: {
            ...input.content,
            summary: { ...cited, support: 'needs_source' },
            history: [cited],
            features: [cited],
            applicability: [context],
            citations: [citation],
          },
          methodWrites: [
            {
              methodId: null,
              expectedVersionId: null,
              definition: {
                ...definition,
                history: [cited],
                applicability: [context],
                interpretationLimits: [cited],
                citations: [citation],
              },
            },
          ],
        }),
      );
      expect(saved.entry.content.applicability).toEqual([context]);
      expect(saved.methodVersions[0]!.definition.interpretationLimits).toEqual([
        cited,
      ]);
      expect(saved.citations).toContainEqual(citation);
      expect(
        await knowledge.create(ownerId, {
          ...input,
          requestKey: randomUUID(),
          content: {
            ...input.content,
            citations: [{ ...citation, relation: 'comparison' }],
          },
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'SOURCE_UNAVAILABLE' },
      });
    });
  });

  it('should pin linked methods when creating and updating another entry', async () => {
    await withKnowledge(async ({ ownerId, knowledge }) => {
      const original = value(await knowledge.create(ownerId, knowledgeInput()));
      const method = original.methodVersions[0]!;
      const input = {
        ...knowledgeInput(),
        linkedMethodIds: [method.methodId],
        methodWrites: [],
      };
      const linked = value(await knowledge.create(ownerId, input));
      expect(linked.methodVersions.map((item) => item.id)).toEqual([method.id]);
      const update = {
        ...knowledgeInput(),
        requestKey: randomUUID(),
        expectedRevision: 1,
        linkedMethodIds: [method.methodId],
      };
      const saved = value(
        await knowledge.update(ownerId, linked.entry.id, update),
      );
      expect(saved.methodVersions).toHaveLength(2);
      expect(saved.methodVersions).toContainEqual(method);
      expect(
        value(await knowledge.update(ownerId, linked.entry.id, update)),
      ).toEqual(saved);
      expect(
        await knowledge.update(ownerId, linked.entry.id, {
          ...update,
          status: 'saved',
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    });
  });

  it.each(['create', 'update'] as const)(
    'should reject duplicate method identities during %s without changing stored revisions',
    async (operation) => {
      await withKnowledge(async ({ ownerId, knowledge }) => {
        const original = value(
          await knowledge.create(ownerId, knowledgeInput()),
        );
        const methodId = original.methodVersions[0]!.methodId;
        const input = {
          ...knowledgeInput(),
          linkedMethodIds: [methodId, methodId],
          methodWrites: [],
        };
        const result =
          operation === 'create'
            ? await knowledge.create(ownerId, input)
            : await knowledge.update(ownerId, original.entry.id, {
                ...input,
                expectedRevision: 1,
              });
        expect(result).toMatchObject({
          success: false,
          error: { code: 'VALIDATION_FAILED' },
        });
        expect(
          value(await knowledge.get(ownerId, original.entry.id)).entry.revision,
        ).toBe(1);
        expect(value(await knowledge.list(ownerId, {})).items).toHaveLength(1);
      });
    },
  );

  it.each([
    'missing method',
    'foreign method',
    'missing expected version',
    'missing version',
    'wrong method version',
    'stale version',
  ] as const)('should roll back an update with %s', async (scenario) => {
    await withKnowledge(async ({ ownerId, knowledge }) => {
      const original = value(await knowledge.create(ownerId, knowledgeInput()));
      const other = value(await knowledge.create(ownerId, knowledgeInput()));
      const method = original.methodVersions[0]!;
      const foreign = other.methodVersions[0]!;
      const input = knowledgeInput();
      let revision = 1;
      if (scenario === 'stale version') {
        value(
          await knowledge.update(ownerId, original.entry.id, {
            ...input,
            expectedRevision: 1,
            methodWrites: [
              {
                methodId: method.methodId,
                expectedVersionId: method.id,
                definition: method.definition,
              },
            ],
          }),
        );
        revision = 2;
      }
      const before = value(await knowledge.get(ownerId, original.entry.id));
      const methodId =
        scenario === 'missing method'
          ? randomUUID()
          : scenario === 'foreign method'
            ? foreign.methodId
            : method.methodId;
      const expectedVersionId =
        scenario === 'missing expected version'
          ? null
          : scenario === 'missing version'
            ? randomUUID()
            : scenario === 'wrong method version' ||
                scenario === 'foreign method'
              ? foreign.id
              : method.id;
      expect(
        await knowledge.update(ownerId, original.entry.id, {
          ...input,
          requestKey: randomUUID(),
          expectedRevision: revision,
          methodWrites: [
            { methodId, expectedVersionId, definition: method.definition },
          ],
        }),
      ).toMatchObject({
        success: false,
        error: {
          code:
            scenario === 'stale version'
              ? 'REVISION_CONFLICT'
              : 'VALIDATION_FAILED',
        },
      });
      expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
        before,
      );
    });
  });

  it.each(['entry', 'method'] as const)(
    'should roll back when the %s compare-and-swap loses a race',
    async (target) => {
      await withKnowledge(async ({ ownerId, knowledge, withRepository }) => {
        const original = value(
          await knowledge.create(ownerId, knowledgeInput()),
        );
        const method = original.methodVersions[0]!;
        const racing = withRepository(
          target === 'entry'
            ? { addRevision: async () => false }
            : { addMethodVersion: async () => false },
        );
        expect(
          await racing.update(ownerId, original.entry.id, {
            ...knowledgeInput(),
            expectedRevision: 1,
            methodWrites: [
              {
                methodId: method.methodId,
                expectedVersionId: method.id,
                definition: method.definition,
              },
            ],
          }),
        ).toMatchObject({
          success: false,
          error: { code: 'REVISION_CONFLICT', retryable: true },
        });
        expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
          original,
        );
      });
    },
  );

  it.each(['create', 'update'] as const)(
    'should reject an inaccessible linked method during %s',
    async (operation) => {
      await withKnowledge(async ({ ownerId, knowledge }) => {
        const original = value(
          await knowledge.create(ownerId, knowledgeInput()),
        );
        const input = {
          ...knowledgeInput(),
          linkedMethodIds: [randomUUID()],
          methodWrites: [],
        };
        const result =
          operation === 'create'
            ? await knowledge.create(ownerId, input)
            : await knowledge.update(ownerId, original.entry.id, {
                ...input,
                expectedRevision: 1,
              });
        expect(result).toMatchObject({
          success: false,
          error: { code: 'SOURCE_UNAVAILABLE' },
        });
        expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
          original,
        );
        expect(value(await knowledge.list(ownerId, {})).items).toHaveLength(1);
      });
    },
  );

  it('should reject updates to missing entries and invalid changes to existing entries', async () => {
    await withKnowledge(async ({ ownerId, knowledge }) => {
      expect(
        await knowledge.update(ownerId, randomUUID(), {
          ...knowledgeInput(),
          expectedRevision: 1,
        }),
      ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      const original = value(await knowledge.create(ownerId, knowledgeInput()));
      const input = knowledgeInput();
      expect(
        await knowledge.update(ownerId, original.entry.id, {
          ...input,
          expectedRevision: 1,
          content: {
            ...input.content,
            summary: {
              textZhHant: '未核實',
              support: 'needs_source',
              citationIds: [randomUUID()],
            },
          },
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
        original,
      );
    });
  });

  it.each(['create', 'update'] as const)(
    'should roll back %s when a linked version cannot be read',
    async (operation) => {
      await withKnowledge(async ({ ownerId, knowledge, withRepository }) => {
        const original = value(
          await knowledge.create(ownerId, knowledgeInput()),
        );
        const unavailable = withRepository({
          getMethodVersion: async () => null,
        });
        const input = {
          ...knowledgeInput(),
          linkedMethodIds: [original.methodVersions[0]!.methodId],
          methodWrites: [],
        };
        const result =
          operation === 'create'
            ? await unavailable.create(ownerId, input)
            : await unavailable.update(ownerId, original.entry.id, {
                ...input,
                expectedRevision: 1,
              });
        expect(result).toMatchObject({
          success: false,
          error: { code: 'SOURCE_UNAVAILABLE' },
        });
        expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
          original,
        );
        expect(value(await knowledge.list(ownerId, {})).items).toHaveLength(1);
      });
    },
  );

  it.each(['create', 'update'] as const)(
    'should roll back %s when repository readback is inconsistent',
    async (operation) => {
      await withKnowledge(async ({ ownerId, knowledge, withRepository }) => {
        const original = value(
          await knowledge.create(ownerId, knowledgeInput()),
        );
        let reads = 0;
        const inconsistent = withRepository({
          get: async () =>
            operation === 'update' && reads++ === 0 ? original : null,
        });
        const input = knowledgeInput();
        const result =
          operation === 'create'
            ? await inconsistent.create(ownerId, input)
            : await inconsistent.update(ownerId, original.entry.id, {
                ...input,
                expectedRevision: 1,
              });
        expect(result).toMatchObject({
          success: false,
          error: { code: 'NOT_FOUND' },
        });
        expect(value(await knowledge.get(ownerId, original.entry.id))).toEqual(
          original,
        );
        expect(value(await knowledge.list(ownerId, {})).items).toHaveLength(1);
      });
    },
  );

  it('should refuse adopting an existing method as a newly owned method', async () => {
    await withKnowledge(async ({ ownerId, knowledge }) => {
      const original = value(await knowledge.create(ownerId, knowledgeInput()));
      const method = original.methodVersions[0]!;
      const input = knowledgeInput();
      expect(
        await knowledge.create(ownerId, {
          ...input,
          methodWrites: [
            {
              ...input.methodWrites[0]!,
              methodId: method.methodId,
              expectedVersionId: method.id,
            },
          ],
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(value(await knowledge.list(ownerId, {})).items).toHaveLength(1);
    });
  });
});

interface KnowledgeContext {
  readonly ownerId: string;
  readonly transaction: TransactionPort;
  readonly knowledge: KnowledgeService;
  readonly withRepository: (
    overrides: Partial<UnitOfWork['knowledge']>,
  ) => KnowledgeService;
}

async function withKnowledge(
  run: (context: KnowledgeContext) => Promise<void>,
): Promise<void> {
  const database = createDatabase({ url: databaseUrl! });
  const transaction = createTransactionPort(database.db);
  const ownerId = randomUUID();
  try {
    await run({
      ownerId,
      transaction,
      knowledge: createKnowledgeService(transaction, clock, ids),
      withRepository: (overrides) =>
        createKnowledgeService(
          {
            run: async (owner, operation) =>
              transaction.run(owner, async (unit) =>
                operation({
                  ...unit,
                  knowledge: { ...unit.knowledge, ...overrides },
                }),
              ),
          },
          clock,
          ids,
        ),
    });
  } finally {
    await database.close();
  }
}

async function persistCitation(
  transaction: TransactionPort,
  ownerId: string,
): Promise<SourceCitation> {
  const sourceId = randomUUID();
  const sourceVersionId = randomUUID();
  const citation: SourceCitation = {
    id: randomUUID(),
    locator: {
      kind: 'web',
      sourceId,
      sourceVersionId,
      url: 'https://museum.example/source',
      retrievedAt: clock.now(),
      snapshotAssetId: null,
      blockId: null,
      excerptAsRetrieved: '原始來源',
    },
    relation: 'supports',
    availability: 'link_only',
    verification: 'located',
  };
  const metadata = {
    title: '館藏來源',
    contributors: [],
    authorStatus: 'unknown' as const,
    editionStatement: null,
    publisher: null,
    publicationDateAsPrinted: null,
    isbn: null,
    languages: [],
    canonicalUrl: 'https://museum.example/source',
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
          sourceHash: 'ab'.repeat(32),
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
      await unit.sources.addCitation(citation);

      return { success: true, data: undefined };
    }),
  );

  return citation;
}

function value<T>(result: OperationResult<T>): T {
  if (!result.success) {
    throw new Error(
      `Fixture operation failed: ${result.error.code}: ${result.error.message}`,
    );
  }

  return result.data;
}
