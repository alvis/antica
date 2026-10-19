import { randomUUID } from 'node:crypto';

import { describe, expect, inject } from 'vitest';

import {
  RecordMessageCursorError,
  RecordMessageReplayConflictError,
} from '@antica/application/ports';

import { knowledgeEvidenceSnapshotV1Schema } from '@antica/contracts';

import { createDatabase } from '../connection.js';

import { Prisma } from '../generated/client.js';
import { createDatabaseTest } from '../spec/fixtures/runner.js';

import { createEditDraftRepository } from './edit-drafts.js';
import { createKnowledgeRepository } from './knowledge.js';
import { createRecordMessageRepository } from './record-messages.js';

import type {
  EditDraftRunRecord,
  ModelInvocation,
} from '@antica/application/ports';
import type {
  EditDraftResult,
  KnowledgeContentEnvelopeV2,
} from '@antica/contracts';

import type { RunnerDatabase } from '../spec/fixtures/runner.js';

const resources = inject('platformDatabases');
const it = createDatabaseTest(resources['record-messages']!);

const baseTime = Date.parse('2026-10-16T00:00:00.000Z');

function at(seconds: number): string {
  return new Date(baseTime + seconds * 1000).toISOString();
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/**
 * seeds an edit draft and its job for an existing record
 * @param connection database of the running suite
 * @param connection.db Prisma client for the running suite
 * @param ownerId collector owning the rows
 * @param recordId record the draft belongs to
 * @returns identifier of the seeded edit draft
 */
async function seedDraft(
  { db }: RunnerDatabase,
  ownerId: string,
  recordId: string,
): Promise<string> {
  const editDraftId = randomUUID();
  const jobId = randomUUID();
  await db.jobs.createMany({
    data: {
      id: jobId,
      ownerId,
      kind: 'recordEditing',
      resourceId: editDraftId,
      state: 'queued',
      stage: 'draft',
    },
  });
  await db.editDraftRuns.createMany({
    data: {
      id: editDraftId,
      ownerId,
      jobId,
      recordId,
      revision: 1,
      status: 'pending',
      snapshot: {},
      request: {},
      modelSelection: {},
      createdAt: at(0),
      updatedAt: at(0),
    },
  });

  return editDraftId;
}

/**
 * seeds one owned record with an edit draft of that record
 * @param connection database of the running suite
 * @param ownerId collector owning the seeded rows
 * @returns identifiers of the seeded rows
 */
async function seed(
  connection: RunnerDatabase,
  ownerId: string = randomUUID(),
): Promise<{ ownerId: string; recordId: string; editDraftId: string }> {
  const recordId = randomUUID();
  await connection.db.records.createMany({
    data: {
      id: recordId,
      ownerId,
      code: `TEST-${recordId}`,
      unitKind: 'single',
    },
  });

  return {
    ownerId,
    recordId,
    editDraftId: await seedDraft(connection, ownerId, recordId),
  };
}

/**
 * runs one committed transaction against the owner-scoped repository
 * @param connection database of the running suite
 * @param ownerId collector the repository is scoped to
 * @param operation work performed inside the transaction
 * @returns the operation result
 */
async function withRepository<T>(
  connection: RunnerDatabase,
  ownerId: string,
  operation: (
    repository: ReturnType<typeof createRecordMessageRepository>,
  ) => Promise<T>,
): Promise<T> {
  return connection.db.$transaction(async (tx) =>
    operation(createRecordMessageRepository(tx, ownerId)),
  );
}

async function countMessages(
  { db }: RunnerDatabase,
  recordId: string,
): Promise<number> {
  return (await db.recordMessages.findMany({ where: { recordId } })).length;
}

describe('fn:createRecordMessageRepository', { timeout: 30_000 }, () => {
  describe('insertCollectorMessage', () => {
    it('should store a trimmed collector message linked to its edit draft', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const id = randomUUID();

      const stored = await withRepository(
        connection,
        ownerId,
        async (repository) =>
          repository.insertCollectorMessage({
            id,
            recordId,
            requestKey: randomUUID(),
            body: '  Please tidy the description  ',
            editDraftId,
            createdAt: '2026-10-16T00:00:01Z',
          }),
      );

      expect(stored).toEqual({
        created: true,
        message: {
          id,
          recordId,
          author: 'collector',
          body: 'Please tidy the description',
          editDraftId,
          createdAt: '2026-10-16T00:00:01.000Z',
        },
      });
    });

    it('should return the stored message and write nothing when the same post is replayed', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const requestKey = randomUUID();
      const store = async (id: string, body: string, createdAt: string) =>
        withRepository(connection, ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id,
            recordId,
            requestKey,
            body,
            editDraftId,
            createdAt,
          }),
        );
      const first = await store(randomUUID(), 'First', at(1));

      const replay = await store(randomUUID(), '  First  ', at(9));

      expect(replay).toEqual({ created: false, message: first.message });
      expect(await countMessages(connection, recordId)).toBe(1);
    });

    it('should reject a replayed request key that carries a different body', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const requestKey = randomUUID();
      const store = async (body: string) =>
        withRepository(connection, ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey,
            body,
            editDraftId,
            createdAt: at(1),
          }),
        );
      await store('First');

      await expect(store('Replayed with other text')).rejects.toThrow(
        RecordMessageReplayConflictError,
      );
      expect(await countMessages(connection, recordId)).toBe(1);
    });

    it('should reject a replayed request key that points at another record or edit draft', async ({
      connection,
    }) => {
      const first = await seed(connection);
      const second = await seed(connection, first.ownerId);
      const sibling = {
        editDraftId: await seedDraft(connection, first.ownerId, first.recordId),
      };
      const requestKey = randomUUID();
      const store = async (recordId: string, editDraftId: string) =>
        withRepository(connection, first.ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey,
            body: 'Same body',
            editDraftId,
            createdAt: at(1),
          }),
        );
      await store(first.recordId, first.editDraftId);

      await expect(store(second.recordId, second.editDraftId)).rejects.toThrow(
        RecordMessageReplayConflictError,
      );
      await expect(store(first.recordId, sibling.editDraftId)).rejects.toThrow(
        RecordMessageReplayConflictError,
      );
      expect(await countMessages(connection, first.recordId)).toBe(1);
      expect(await countMessages(connection, second.recordId)).toBe(0);
    });

    it('should reject a blank collector body before touching the database', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);

      await expect(
        withRepository(connection, ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey: randomUUID(),
            body: ' \n\t ',
            editDraftId,
            createdAt: at(1),
          }),
        ),
      ).rejects.toThrow('Collector message body must not be blank');
      expect(await countMessages(connection, recordId)).toBe(0);
    });

    it('should keep one message when the same request key arrives concurrently', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const requestKey = randomUUID();
      const racing = createDatabase({ url: connection.url, maxConnections: 2 });
      try {
        const results = await Promise.all(
          [1, 2].map(async () =>
            racing.db.$transaction(async (tx) =>
              createRecordMessageRepository(tx, ownerId).insertCollectorMessage(
                {
                  id: randomUUID(),
                  recordId,
                  requestKey,
                  body: 'Same post',
                  editDraftId,
                  createdAt: at(1),
                },
              ),
            ),
          ),
        );

        expect(results.filter((result) => result.created)).toHaveLength(1);
        expect(new Set(results.map((result) => result.message.id)).size).toBe(
          1,
        );
        expect(await countMessages(connection, recordId)).toBe(1);
      } finally {
        await racing.close();
      }
    });

    it('should scope request keys to their owner', async ({ connection }) => {
      const first = await seed(connection);
      const second = await seed(connection);
      const requestKey = randomUUID();
      const store = async (seeded: typeof first) =>
        withRepository(connection, seeded.ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id: randomUUID(),
            recordId: seeded.recordId,
            requestKey,
            body: 'Same key',
            editDraftId: seeded.editDraftId,
            createdAt: at(1),
          }),
        );

      const results = [await store(first), await store(second)];

      expect(results.map((result) => result.created)).toEqual([true, true]);
      expect(results[0]!.message.recordId).toBe(first.recordId);
      expect(results[1]!.message.recordId).toBe(second.recordId);
    });

    it('should reject a record or edit draft the collector cannot access', async ({
      connection,
    }) => {
      const mine = await seed(connection);
      const theirs = await seed(connection);
      const other = await seed(connection, mine.ownerId);
      const attempt = async (recordId: string, editDraftId: string) =>
        withRepository(connection, mine.ownerId, async (repository) =>
          repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey: randomUUID(),
            body: 'Hello',
            editDraftId,
            createdAt: at(1),
          }),
        );
      const inaccessible = 'Record message dependencies are inaccessible';

      await expect(
        attempt(theirs.recordId, theirs.editDraftId),
      ).rejects.toThrow(inaccessible);
      await expect(attempt(randomUUID(), mine.editDraftId)).rejects.toThrow(
        inaccessible,
      );
      await expect(attempt(mine.recordId, theirs.editDraftId)).rejects.toThrow(
        inaccessible,
      );
      await expect(attempt(mine.recordId, randomUUID())).rejects.toThrow(
        inaccessible,
      );
      await expect(attempt(mine.recordId, other.editDraftId)).rejects.toThrow(
        inaccessible,
      );
      expect(await countMessages(connection, mine.recordId)).toBe(0);
    });
  });

  describe('insertAssistantReply', () => {
    it('should store a trimmed assistant reply for the edit draft', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const id = randomUUID();

      const stored = await withRepository(
        connection,
        ownerId,
        async (repository) =>
          repository.insertAssistantReply({
            id,
            recordId,
            editDraftId,
            body: ' I suggest two changes. ',
            createdAt: at(2),
          }),
      );

      expect(stored).toEqual({
        created: true,
        message: {
          id,
          recordId,
          author: 'assistant',
          body: 'I suggest two changes.',
          knowledgeEvidence: [],
          answerSegments: [],
          editDraftId,
          createdAt: at(2),
        },
      });
    });

    it('should return the first reply and write nothing when the edit draft already has one', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const reply = async (body: string) =>
        withRepository(connection, ownerId, async (repository) =>
          repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body,
            createdAt: at(2),
          }),
        );
      const first = await reply('First reply');

      const second = await reply('Second reply');

      expect(second).toEqual({ created: false, message: first.message });
      expect(await countMessages(connection, recordId)).toBe(1);
    });

    it('should reject a blank assistant reply before touching the database', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);

      await expect(
        withRepository(connection, ownerId, async (repository) =>
          repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body: '   ',
            createdAt: at(2),
          }),
        ),
      ).rejects.toThrow('Assistant reply body must not be blank');
      expect(await countMessages(connection, recordId)).toBe(0);
    });

    it('should allow a collector message and an assistant reply on the same edit draft', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);

      const [collector, assistant] = await withRepository(
        connection,
        ownerId,
        async (repository) => [
          await repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey: randomUUID(),
            body: 'Question',
            editDraftId,
            createdAt: at(1),
          }),
          await repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body: 'Answer',
            createdAt: at(2),
          }),
        ],
      );

      expect([collector.created, assistant.created]).toEqual([true, true]);
    });

    it('should reject a record or edit draft the collector cannot access', async ({
      connection,
    }) => {
      const mine = await seed(connection);
      const theirs = await seed(connection);
      const other = await seed(connection, mine.ownerId);
      const attempt = async (recordId: string, editDraftId: string) =>
        withRepository(connection, mine.ownerId, async (repository) =>
          repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body: 'Reply',
            createdAt: at(2),
          }),
        );
      const inaccessible = 'Record message dependencies are inaccessible';

      await expect(
        attempt(theirs.recordId, theirs.editDraftId),
      ).rejects.toThrow(inaccessible);
      await expect(attempt(mine.recordId, other.editDraftId)).rejects.toThrow(
        inaccessible,
      );
      await expect(attempt(mine.recordId, randomUUID())).rejects.toThrow(
        inaccessible,
      );
      expect(await countMessages(connection, mine.recordId)).toBe(0);
    });
  });

  describe('findCollectorMessage', () => {
    it('should find the collector message that started the edit draft', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const stored = await withRepository(
        connection,
        ownerId,
        async (repository) => {
          const collector = await repository.insertCollectorMessage({
            id: randomUUID(),
            recordId,
            requestKey: randomUUID(),
            body: 'Question',
            editDraftId,
            createdAt: at(1),
          });
          await repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body: 'Answer',
            createdAt: at(2),
          });

          return collector.message;
        },
      );

      const found = await withRepository(
        connection,
        ownerId,
        async (repository) => repository.findCollectorMessage(editDraftId),
      );

      expect(found).toEqual(stored);
    });

    it('should return null for a draft without a collector message, another owner or an unknown draft', async ({
      connection,
    }) => {
      const mine = await seed(connection);
      const theirs = await seed(connection);
      await connection.db.recordMessages.createMany({
        data: {
          id: randomUUID(),
          ownerId: theirs.ownerId,
          recordId: theirs.recordId,
          editDraftId: theirs.editDraftId,
          author: 'collector',
          body: 'Not yours',
          requestKey: randomUUID(),
          createdAt: at(1),
        },
      });
      const find = async (editDraftId: string) =>
        withRepository(connection, mine.ownerId, async (repository) =>
          repository.findCollectorMessage(editDraftId),
        );

      expect(await find(mine.editDraftId)).toBeNull();
      expect(await find(theirs.editDraftId)).toBeNull();
      expect(await find(randomUUID())).toBeNull();
    });
  });

  describe('listByRecord', () => {
    async function seedConversation(
      connection: RunnerDatabase,
      count: number,
    ): Promise<{ ownerId: string; recordId: string; draftIds: string[] }> {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const draftIds = [editDraftId];
      for (let pair = 1; pair < Math.ceil(count / 2); pair += 1) {
        draftIds.push(await seedDraft(connection, ownerId, recordId));
      }
      await connection.db.recordMessages.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          id: randomUUID(),
          ownerId,
          recordId,
          editDraftId: draftIds[Math.floor(index / 2)]!,
          author: index % 2 === 0 ? 'collector' : 'assistant',
          body: `Message ${index}`,
          requestKey: index % 2 === 0 ? randomUUID() : null,
          createdAt: at(index),
        })),
      });

      return { ownerId, recordId, draftIds };
    }

    const list = async (
      connection: RunnerDatabase,
      ownerId: string,
      input: Parameters<
        ReturnType<typeof createRecordMessageRepository>['listByRecord']
      >[0],
    ) =>
      withRepository(connection, ownerId, async (repository) =>
        repository.listByRecord(input),
      );

    it('should return an empty page for a record without messages', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seed(connection);

      expect(await list(connection, ownerId, { recordId })).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('should return the newest messages first page in chronological order', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seedConversation(connection, 5);

      const page = await list(connection, ownerId, { recordId, limit: 2 });

      expect(page.items.map((item) => item.message.body)).toEqual([
        'Message 3',
        'Message 4',
      ]);
      expect(page.nextCursor).not.toBeNull();
    });

    it('should break equal instants by identifier', async ({ connection }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const [low, high] = [randomUUID(), randomUUID()].sort() as [
        string,
        string,
      ];
      await connection.db.recordMessages.createMany({
        data: [
          [randomUUID(), 'late', 5],
          [high, 'tie high', 1],
          [low, 'tie low', 1],
        ].map(([id, body, second]) => ({
          id: id as string,
          ownerId,
          recordId,
          editDraftId,
          author: 'collector',
          requestKey: randomUUID(),
          body: body as string,
          createdAt: at(second as number),
        })),
      });

      const page = await list(connection, ownerId, { recordId });

      expect(page.items.map((item) => item.message.body)).toEqual([
        'tie low',
        'tie high',
        'late',
      ]);
      expect(page.nextCursor).toBeNull();
    });

    it('should page back through the conversation without gaps or repeats', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seedConversation(connection, 5);
      const pages: string[][] = [];
      const cursors: Array<string | null> = [];
      let cursor: string | null = null;

      do {
        const page: Awaited<ReturnType<typeof list>> = await list(
          connection,
          ownerId,
          { recordId, cursor, limit: 2 },
        );
        pages.push(page.items.map((item) => item.message.body));
        cursors.push(page.nextCursor);
        cursor = page.nextCursor;
      } while (cursor);

      expect(pages).toEqual([
        ['Message 3', 'Message 4'],
        ['Message 1', 'Message 2'],
        ['Message 0'],
      ]);
      expect(cursors.map((value) => value === null)).toEqual([
        false,
        false,
        true,
      ]);
    });

    it('should continue past a tie of equal instants', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
      await connection.db.recordMessages.createMany({
        data: ids.map((id, index) => ({
          id,
          ownerId,
          recordId,
          editDraftId,
          author: 'collector',
          requestKey: randomUUID(),
          body: `Tie ${index}`,
          createdAt: at(1),
        })),
      });

      const first = await list(connection, ownerId, { recordId, limit: 2 });
      const second = await list(connection, ownerId, {
        recordId,
        cursor: first.nextCursor,
        limit: 2,
      });

      expect(first.items.map((item) => item.message.body)).toEqual([
        'Tie 1',
        'Tie 2',
      ]);
      expect(second.items.map((item) => item.message.body)).toEqual(['Tie 0']);
      expect(second.nextCursor).toBeNull();
    });

    it('should end the last page exactly at the limit without a cursor', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seedConversation(connection, 4);

      const page = await list(connection, ownerId, { recordId, limit: 4 });

      expect(page.items).toHaveLength(4);
      expect(page.nextCursor).toBeNull();
    });

    it('should default to 50 messages and cap a page at the shared maximum', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seedConversation(connection, 101);

      const [defaulted, capped, floored] = [
        await list(connection, ownerId, { recordId }),
        await list(connection, ownerId, { recordId, limit: 1000 }),
        await list(connection, ownerId, { recordId, limit: 0 }),
      ];

      expect(defaulted.items).toHaveLength(50);
      expect(defaulted.items.at(-1)?.message.body).toBe('Message 100');
      expect(defaulted.nextCursor).not.toBeNull();
      expect(capped.items).toHaveLength(100);
      expect(capped.nextCursor).not.toBeNull();
      expect(floored.items.map((item) => item.message.body)).toEqual([
        'Message 100',
      ]);
    });

    it('should return nothing for a record owned by another collector', async ({
      connection,
    }) => {
      const { recordId } = await seedConversation(connection, 3);

      expect(await list(connection, randomUUID(), { recordId })).toEqual({
        items: [],
        nextCursor: null,
      });
    });

    it('should reject a malformed cursor', async ({ connection }) => {
      const { ownerId, recordId } = await seed(connection);
      const attempt = async (cursor: string) =>
        list(connection, ownerId, { recordId, cursor });

      await expect(attempt('%%%')).rejects.toThrow(RecordMessageCursorError);
      await expect(
        attempt(encode({ createdAt: 'later', id: 'x' })),
      ).rejects.toThrow(RecordMessageCursorError);
      await expect(attempt(encode({ id: randomUUID() }))).rejects.toThrow(
        'Record message cursor is invalid',
      );
    });

    it('should carry the draft facts of a waiting draft', async ({
      connection,
    }) => {
      const { ownerId, recordId, draftIds } = await seedConversation(
        connection,
        2,
      );

      const page = await list(connection, ownerId, { recordId });

      expect(page.items.map((item) => item.draft)).toEqual(
        Array.from({ length: 2 }, () => ({
          status: 'pending',
          revision: 1,
          proposedChanges: [],
          appliedProposalIds: [],
          skippedProposalIds: [],
          jobFailed: false,
        })),
      );
      expect(page.items.map((item) => item.message.editDraftId)).toEqual(
        Array.from({ length: 2 }, () => draftIds[0]),
      );
    });

    it('should carry the proposals, applied and skipped proposals and revision of a saved result', async ({
      connection,
    }) => {
      const { ownerId, recordId, draftIds } = await seedConversation(
        connection,
        2,
      );
      const proposal = (id: string, proposed: string) => ({
        id,
        field: 'description',
        before: '',
        proposed,
        findingIds: [],
      });
      const [first, second, third] = [randomUUID(), randomUUID(), randomUUID()];
      await connection.db.editDraftRuns.updateMany({
        data: {
          status: 'partially_applied',
          revision: 3,
          appliedProposalIds: [first],
          result: {
            editDraftId: draftIds[0],
            recordId,
            baseVersions: {
              recordRevision: 1,
              analysisInputVersion: 1,
              evidenceVersion: 1,
            },
            sourceTranscriptionIds: [],
            sourceObservationIds: [],
            suggestedDescriptionZhHant: 'text',
            proposedChanges: [
              proposal(first, 'one'),
              proposal(second, 'two'),
              proposal(third, 'three'),
            ],
          },
        },
        where: { id: draftIds[0]! },
      });
      // the skipped entries are written out of proposal order on purpose
      for (const [proposalId, proposed] of [
        [third, 'three'],
        [second, 'two'],
      ] as const) {
        await connection.db.editDraftAdoptionEvents.createMany({
          data: {
            id: randomUUID(),
            ownerId,
            editDraftId: draftIds[0]!,
            recordId,
            proposalId,
            field: 'description',
            before: '',
            after: proposed,
            status: 'skipped',
            recordRevision: 1,
          },
        });
      }

      const page = await list(connection, ownerId, { recordId });

      expect(page.items[1]!.draft).toEqual({
        status: 'partially_applied',
        revision: 3,
        proposedChanges: [
          proposal(first, 'one'),
          proposal(second, 'two'),
          proposal(third, 'three'),
        ],
        appliedProposalIds: [first],
        skippedProposalIds: [second, third],
        jobFailed: false,
      });
    });

    it('should report a failed job of the draft', async ({ connection }) => {
      const { ownerId, recordId } = await seedConversation(connection, 2);
      await connection.db.jobs.updateMany({
        data: { state: 'failed', error: { code: 'PROVIDER_UNAVAILABLE' } },
        where: { ownerId },
      });

      const page = await list(connection, ownerId, { recordId });

      expect(page.items.map((item) => item.draft.jobFailed)).toEqual([
        true,
        true,
      ]);
      expect(page.items[0]!.draft.status).toBe('pending');
    });
  });

  describe('table constraints', () => {
    type Seeded = { ownerId: string; recordId: string; editDraftId: string };
    type NewRow = Prisma.recordMessagesCreateManyInput;
    /** a row whose draft may be left out on purpose */
    type DraftlessRow = Omit<NewRow, 'editDraftId'> & {
      editDraftId?: string | null;
    };

    const rejected = async (
      connection: RunnerDatabase,
      build: (seeded: Seeded) => DraftlessRow[],
    ) => {
      const context = await seed(connection);

      return connection.db.$transaction(async (tx) => {
        const rows = build(context);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO record_messages (id, owner_id, record_id, edit_draft_id, author, body, request_key, created_at)
          VALUES ${Prisma.join(
            rows.map(
              (row) => Prisma.sql`(
            ${row.id}::uuid, ${row.ownerId}, ${row.recordId}::uuid,
            ${row.editDraftId ?? null}::uuid, ${row.author}, ${row.body},
            ${row.requestKey ?? null}, ${row.createdAt}::timestamptz
          )`,
            ),
          )}
        `);
      });
    };
    const row = (
      { ownerId, recordId, editDraftId }: Seeded,
      overrides: Partial<NewRow>,
    ): NewRow => ({
      id: randomUUID(),
      ownerId,
      recordId,
      editDraftId,
      author: 'assistant',
      body: 'Hello',
      createdAt: at(1),
      ...overrides,
    });

    it('should require a request key on collector rows only', async ({
      connection,
    }) => {
      await expect(
        rejected(connection, (seeded) => [
          row(seeded, { author: 'collector', body: 'No key' }),
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'record_messages_request_key_ck',
              ),
            },
          },
        },
      });
      await expect(
        rejected(connection, (seeded) => [
          row(seeded, { body: 'No key needed' }),
        ]),
      ).resolves.toBeUndefined();
    });

    it('should accept only known authors and non-blank bodies', async ({
      connection,
    }) => {
      await expect(
        rejected(connection, (seeded) => [
          row(seeded, { author: 'system', requestKey: randomUUID() }),
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'record_messages_author_ck',
              ),
            },
          },
        },
      });
      await expect(
        rejected(connection, (seeded) => [row(seeded, { body: ' \n\t ' })]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23514',
              originalMessage: expect.stringContaining(
                'record_messages_body_ck',
              ),
            },
          },
        },
      });
    });

    it('should require every message to belong to an edit draft', async ({
      connection,
    }) => {
      await expect(
        rejected(connection, (seeded) => [
          { ...row(seeded, {}), editDraftId: undefined },
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23502',
              originalMessage: expect.stringContaining('edit_draft_id'),
            },
          },
        },
      });
      await expect(
        rejected(connection, (seeded) => [
          { ...row(seeded, {}), editDraftId: null },
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23502',
              originalMessage: expect.stringContaining('edit_draft_id'),
            },
          },
        },
      });
    });

    it('should reject a repeated request key of the same owner', async ({
      connection,
    }) => {
      const requestKey = randomUUID();

      await expect(
        rejected(connection, (seeded) =>
          [1, 2].map((second) =>
            row(seeded, {
              author: 'collector',
              body: 'Duplicate',
              requestKey,
              createdAt: at(second),
            }),
          ),
        ),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23505',
              originalMessage: expect.stringContaining(
                'record_messages_owner_request_uq',
              ),
            },
          },
        },
      });
    });

    it('should reject a second assistant reply for one edit draft but allow collector rows', async ({
      connection,
    }) => {
      await expect(
        rejected(connection, (seeded) =>
          [1, 2].map((second) =>
            row(seeded, { body: 'Reply', createdAt: at(second) }),
          ),
        ),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23505',
              originalMessage: expect.stringContaining(
                'record_messages_assistant_reply_uq',
              ),
            },
          },
        },
      });
      await expect(
        rejected(connection, (seeded) =>
          [1, 2].map((second) =>
            row(seeded, {
              author: 'collector',
              body: 'Follow-up',
              requestKey: randomUUID(),
              createdAt: at(second),
            }),
          ),
        ),
      ).resolves.toBeUndefined();
    });

    it('should reject a record or edit draft that does not exist', async ({
      connection,
    }) => {
      await expect(
        rejected(connection, (seeded) => [
          row(seeded, { recordId: randomUUID() }),
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23503',
              originalMessage: expect.stringContaining(
                'record_messages_record_id_records_id_fk',
              ),
            },
          },
        },
      });
      await expect(
        rejected(connection, (seeded) => [
          row(seeded, { editDraftId: randomUUID() }),
        ]),
      ).rejects.toMatchObject({
        meta: {
          driverAdapterError: {
            cause: {
              originalCode: '23503',
              originalMessage: expect.stringContaining(
                'record_messages_edit_draft_id_edit_draft_runs_id_fk',
              ),
            },
          },
        },
      });
    });

    it('should index the paging order and the owner-scoped identity', async ({
      connection,
    }) => {
      const rows = await connection.db.$queryRaw<
        Array<{
          indexname: string;
          indexdef: string;
        }>
      >`select indexname, indexdef from pg_indexes where tablename = 'record_messages'`;
      const definitions = new Map(
        rows.map((index) => [index.indexname, index.indexdef]),
      );

      expect(definitions.get('record_messages_record_idx')).toContain(
        '(record_id, created_at, id)',
      );
      expect(definitions.get('record_messages_owner_id_uq')).toMatch(
        /UNIQUE INDEX .*\(owner_id, id\)/,
      );
    });
  });
});

describe(
  'fn:createRecordMessageRepository frozen knowledge',
  { timeout: 30_000 },
  () => {
    it('should persist frozen evidence and segments without changing record rows, even after a newer knowledge revision', async ({
      connection,
    }) => {
      const { ownerId, recordId } = await seed(connection);
      const knowledge = createKnowledgeRepository(connection.db, ownerId);
      const content = await seedKnowledgeEvidence(connection, ownerId);
      const entryId = randomUUID();
      await knowledge.createV2({
        entryId,
        displayCode: `KN-${entryId}`,
        content,
        status: 'saved',
        savedBy: 'collector',
        reviewedBy: null,
        reviewedAt: null,
      });
      const citation = content.citations[0]!;
      const claim = content.claims[0]!;
      const frozen = knowledgeEvidenceSnapshotV1Schema.parse({
        schemaVersion: 1,
        snapshotId: randomUUID(),
        snapshotHash: 'b'.repeat(64),
        recordId,
        recordRevision: 1,
        corpusGeneration: 'saved-revision-1',
        entries: [
          {
            entryId,
            revision: 1,
            contentHash: 'a'.repeat(64),
            title: 'Museum vase',
            claims: [
              {
                claimId: randomUUID(),
                claimKey: claim.claimKey,
                statement: claim.originalText,
                originalText: claim.originalText,
                language: claim.originalLanguage,
                scope: claim.scope,
                qualifiers: claim.qualifiers,
                uncertainty: claim.uncertainty,
                sourceVersionIds: [citation.source.versionId],
                citations: [
                  {
                    citationId: citation.id,
                    sourceId: citation.source.id,
                    sourceVersionId: citation.source.versionId,
                    locatorId: citation.locator.id,
                    relation: 'supports',
                    sourceTitle: citation.source.title,
                    excerpt: claim.originalText,
                    sourcePageUrl: 'https://museum.example/object',
                  },
                ],
              },
            ],
          },
        ],
      });
      const recordBefore = await connection.db.records.findUniqueOrThrow({
        where: { id: recordId },
      });
      const countsBefore = await recordWriteCounts(connection, recordId);
      const editDraftId = randomUUID();
      const jobId = randomUUID();
      await connection.db.jobs.create({
        data: {
          id: jobId,
          ownerId,
          kind: 'recordEditing',
          resourceId: editDraftId,
          state: 'queued',
          stage: 'draft',
        },
      });
      const versions = {
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
      };
      const run: EditDraftRunRecord = {
        detail: {
          editDraftId,
          jobId,
          revision: 1,
          status: 'pending',
          snapshot: {
            recordId,
            versions,
            fields: {
              name: null,
              unitKind: 'single',
              components: [],
              pieceCount: null,
              categoryIds: [],
              materialIds: [],
              period: null,
              dimensions: {},
              location: { locationId: null, detail: '' },
              acquisition: { receiptAssetIds: [] },
              tags: [],
              description: '',
              collectorJudgment: null,
            },
            transcriptionVersions: [],
            observationIds: [],
            sourceText: [],
            createdAt: at(0),
            knowledgeContext: frozen,
          },
          result: null,
          invocation: null,
          appliedProposalIds: [],
          skippedProposalIds: [],
          createdAt: at(0),
          updatedAt: at(0),
        },
        request: {
          requestKey: editDraftId,
          recordId,
          expectedRecordRevision: 1,
          transcriptionIds: [],
          observationIds: [],
          instructionZhHant: '整理記錄',
        },
        modelSelection: {
          role: 'recordEditing',
          modelId: 'development:evidence-v1',
          profileVersion: '1',
        },
      };
      const drafts = createEditDraftRepository(connection.db, ownerId);
      await drafts.create(run);
      expect(
        (await drafts.get(editDraftId))?.detail.snapshot.knowledgeContext,
      ).toEqual(frozen);
      expect(
        await connection.db.editDraftRuns.findUniqueOrThrow({
          where: { id: editDraftId },
        }),
      ).toMatchObject({ knowledgeContext: frozen });
      expect(
        await createEditDraftRepository(connection.db, randomUUID()).get(
          editDraftId,
        ),
      ).toBeNull();
      const answerSegments = [
        {
          text: 'The catalog describes this museum object.',
          evidenceRefs: [
            {
              entryId,
              revision: 1,
              claimKey: claim.claimKey,
              citationIds: [citation.id],
            },
          ],
        },
      ];
      const result: EditDraftResult = {
        editDraftId,
        recordId,
        baseVersions: versions,
        sourceTranscriptionIds: [],
        sourceObservationIds: [],
        replyZhHant: answerSegments[0]!.text,
        suggestedDescriptionZhHant: '',
        proposedChanges: [],
        answerSegments,
      };
      const invocation: ModelInvocation = {
        requestedModelId: 'development:evidence-v1',
        effectiveModelId: 'development:evidence-v1',
        provider: 'development',
        providerModelVersion: '1',
        adapterKind: 'development',
        capabilities: {
          textInput: true,
          imageInput: false,
          audioInput: false,
          structuredOutput: true,
          toolCalling: false,
        },
        role: 'recordEditing',
        profileVersion: '1',
        promptVersion: 'editing-v3',
        schemaVersion: '1',
        effectiveOptions: {},
        latencyMs: 0,
        usage: { inputTokens: null, outputTokens: null },
        finishReason: 'stop',
        citationCheck: { valid: true, rejectedReferenceIds: [] },
      };
      expect(
        await drafts.saveResult(editDraftId, result, invocation, 1, at(1)),
      ).toBe(true);
      const reply = await withRepository(
        connection,
        ownerId,
        async (repository) =>
          repository.insertAssistantReply({
            id: randomUUID(),
            recordId,
            editDraftId,
            body: result.replyZhHant,
            createdAt: at(2),
          }),
      );
      expect(reply.message).toMatchObject({
        knowledgeEvidence: frozen,
        answerSegments,
      });
      expect(
        await connection.db.recordMessages.findUniqueOrThrow({
          where: { id: reply.message.id },
        }),
      ).toMatchObject({ knowledgeEvidence: frozen });
      await knowledge.addRevisionV2({
        entryId,
        expectedRevision: 1,
        content: {
          ...content,
          titles: [{ language: 'en', text: 'Revised museum attribution' }],
          claims: content.claims.map((item) => ({
            ...item,
            uncertainty: 'Attribution now disputed',
          })),
        },
        status: 'saved',
        savedBy: 'collector',
        reviewedBy: null,
        reviewedAt: null,
      });
      const listed = await withRepository(
        connection,
        ownerId,
        async (repository) => repository.listByRecord({ recordId, limit: 50 }),
      );
      expect(listed.items).toEqual([
        {
          message: expect.objectContaining({
            author: 'assistant',
            editDraftId,
            knowledgeEvidence: frozen,
            answerSegments,
          }),
          draft: expect.objectContaining({ proposedChanges: [] }),
        },
      ]);
      expect(
        (await drafts.get(editDraftId))?.detail.snapshot.knowledgeContext,
      ).toEqual(frozen);
      expect(
        await withRepository(connection, randomUUID(), async (repository) =>
          repository.listByRecord({ recordId, limit: 50 }),
        ),
      ).toEqual({ items: [], nextCursor: null });
      expect(await recordWriteCounts(connection, recordId)).toEqual(
        countsBefore,
      );
      expect(
        await connection.db.records.findUniqueOrThrow({
          where: { id: recordId },
        }),
      ).toEqual(recordBefore);
    });

    it('should return empty evidence and segments for legacy assistant rows', async ({
      connection,
    }) => {
      const { ownerId, recordId, editDraftId } = await seed(connection);
      await connection.db.recordMessages.create({
        data: {
          id: randomUUID(),
          ownerId,
          recordId,
          editDraftId,
          author: 'assistant',
          body: 'Legacy answer',
          createdAt: at(2),
        },
      });
      const listed = await withRepository(
        connection,
        ownerId,
        async (repository) => repository.listByRecord({ recordId, limit: 50 }),
      );
      expect(listed.items).toEqual([
        {
          message: expect.objectContaining({
            knowledgeEvidence: [],
            answerSegments: [],
          }),
          draft: expect.any(Object),
        },
      ]);
    });
  },
);

/**
 * counts record mutation surfaces while excluding the expected message/draft writes
 * @param connection real suite database
 * @param connection.db Prisma client for the running suite
 * @param recordId record whose adoption boundary is under test
 */
async function recordWriteCounts(
  { db }: RunnerDatabase,
  recordId: string,
): Promise<number[]> {
  return Promise.all([
    db.records.count({ where: { id: recordId } }),
    db.recordCategories.count({ where: { recordId } }),
    db.recordMaterials.count({ where: { recordId } }),
    db.recordMeasurements.count({ where: { recordId } }),
    db.recordTags.count({ where: { recordId } }),
    db.recordAcquisitions.count({ where: { recordId } }),
    db.editDraftAdoptionEvents.count({ where: { recordId } }),
  ]);
}

/**
 * creates located immutable source authority for saved and rejected-attachment scenarios
 * @param connection real suite database
 * @param connection.db Prisma client for the running suite
 * @param ownerId source owner
 */
async function seedKnowledgeEvidence(
  { db }: RunnerDatabase,
  ownerId: string,
): Promise<KnowledgeContentEnvelopeV2> {
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const citationId = randomUUID();
  const text = 'This museum object is porcelain, with tentative attribution.';
  const source = {
    id: sourceId,
    versionId,
    title: 'Museum catalog',
    canonicalUrl: 'https://museum.example/object',
    languages: ['en'],
    contributors: [],
  };
  await db.sources.create({
    data: {
      id: sourceId,
      ownerId,
      kind: 'web',
      title: source.title,
      authorStatus: 'unknown',
      access: 'link_only',
    },
  });
  await db.sourceVersions.create({
    data: {
      id: versionId,
      sourceId,
      ownerId,
      sourceHash: 'a'.repeat(64),
      metadataSnapshot: {
        title: source.title,
        canonicalUrl: source.canonicalUrl,
        languages: source.languages,
        contributors: [],
      },
      capturedAt: at(0),
      status: 'registered',
      textIndexStatus: 'registered',
      imageIndexStatus: 'registered',
    },
  });
  await db.sourceLocators.create({
    data: {
      id: citationId,
      sourceId,
      sourceVersionId: versionId,
      kind: 'web',
      url: source.canonicalUrl,
      retrievedAt: at(0),
      excerptAsRetrieved: text,
    },
  });
  await db.citations.create({
    data: {
      id: citationId,
      locatorId: citationId,
      relation: 'supports',
      availability: 'link_only',
      verification: 'located',
    },
  });
  const review = { state: 'reviewed' as const, actor: ownerId, at: at(0) };

  return {
    contentSchemaVersion: 2,
    entryType: 'object_example',
    origin: 'collector',
    titles: [{ language: 'en', text: 'Museum vase' }],
    aliases: [],
    sections: {
      summary: {
        claimKey: 'material',
        text,
        citationIds: [citationId],
        supportState: 'cited',
      },
      history: [],
      features: [],
      applicability: [],
      limits: [],
    },
    claims: [
      {
        claimKey: 'material',
        section: 'summary',
        ordinal: 0,
        originalText: text,
        originalLanguage: 'en',
        statementType: 'observation',
        scope: { object: ['Museum vase'] },
        qualifiers: {},
        uncertainty: 'Tentative attribution',
        supportState: 'cited',
        citationIds: [citationId],
        review,
        variants: [],
      },
    ],
    citations: [
      {
        id: citationId,
        relation: 'supports',
        availability: 'link_only',
        verification: 'located',
        quote: text,
        locator: {
          kind: 'web',
          id: citationId,
          sourceId,
          sourceVersionId: versionId,
          url: source.canonicalUrl,
          retrievedAt: at(0),
          excerpt: text,
        },
        source,
      },
    ],
    topics: [],
    images: [],
    methodIds: [],
    relatedEntryIds: [],
    editorialReview: review,
  };
}
