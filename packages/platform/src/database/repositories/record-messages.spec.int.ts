import { randomUUID } from 'node:crypto';
import { describe, expect, inject } from 'vitest';
import { Prisma } from '../generated/client.js';
import { createDatabaseTest } from '../spec/fixtures/runner.js';
import type { RunnerDatabase } from '../spec/fixtures/runner.js';
const resources = inject('platformDatabases');
const it = createDatabaseTest(resources['record-messages']!);

const baseTime = Date.parse('2026-10-16T00:00:00.000Z');

function at(seconds: number): string {
  return new Date(baseTime + seconds * 1000).toISOString();
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

describe('database message constraints', { timeout: 30_000 }, () => {
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
