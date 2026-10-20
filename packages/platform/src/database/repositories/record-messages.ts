import { z } from 'zod';

import {
  RecordMessageCursorError,
  RecordMessageReplayConflictError,
} from '@antica/application/ports';
import {
  MAX_PAGE_SIZE,
  editDraftDetailSchema,
  editDraftResultSchema,
  entityIdSchema,
  instantSchema,
  recordMessageSchema,
  knowledgeEvidenceSnapshotV1Schema,
  revisionSchema,
} from '@antica/contracts';

import { inProposalOrder, listSkippedProposalIds } from './edit-draft-skips.js';

import type {
  ListedRecordMessage,
  RecordMessageRepository,
} from '@antica/application/ports';
import type { RecordMessage } from '@antica/contracts';

import type { Prisma, recordMessages } from '../generated/client.js';

import type { Transaction } from '../transaction.js';

const DEFAULT_PAGE_SIZE = 50;

const cursorSchema = z.strictObject({
  createdAt: instantSchema,
  id: entityIdSchema,
});

const draftSchema = z.strictObject({
  status: editDraftDetailSchema.shape.status,
  revision: revisionSchema,
  result: editDraftResultSchema.nullable(),
  appliedProposalIds: z.array(entityIdSchema),
});

/**
 * normalizes an instant to millisecond ISO form
 * @param value instant accepted by Date
 * @returns UTC ISO string
 */
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

/**
 * encodes the position of a message
 * @param message oldest message of a page
 * @returns opaque cursor
 */
function encodeCursor(message: RecordMessage): string {
  return Buffer.from(
    JSON.stringify({ createdAt: message.createdAt, id: message.id }),
  ).toString('base64url');
}

/**
 * decodes a cursor produced by a previous page
 * @param value opaque cursor
 * @returns the position before which the next page starts
 * @throws {RecordMessageCursorError} when the cursor is not one this repository produced
 */
function decodeCursor(value: string): z.infer<typeof cursorSchema> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new RecordMessageCursorError();
  }
  const cursor = cursorSchema.safeParse(decoded);
  if (!cursor.success) {
    throw new RecordMessageCursorError();
  }

  return cursor.data;
}

/**
 * maps a stored row to the public message contract
 * @param row persisted record message
 * @returns validated message with an ISO instant
 */
function toMessage(row: recordMessages): RecordMessage {
  return recordMessageSchema.parse({
    id: row.id,
    recordId: row.recordId,
    author: row.author,
    body: row.body,
    editDraftId: row.editDraftId,
    createdAt: iso(row.createdAt),
    ...(row.author === 'assistant'
      ? { knowledgeEvidence: row.knowledgeEvidence ?? [], answerSegments: [] }
      : {}),
  });
}

/**
 * trims a message body and rejects one without visible text
 * @param value untrimmed body
 * @param what message kind named in the error
 * @returns body without surrounding whitespace
 * @throws {Error} when nothing remains after trimming
 */
function requireBody(value: string, what: string): string {
  const body = value.trim();
  if (body === '') {
    throw new Error(`${what} body must not be blank`);
  }

  return body;
}

/**
 * binds the record conversation to one collector and one transaction
 * @param tx transaction every statement runs in
 * @param ownerId collector whose records and drafts are accessible
 * @returns repository whose inserts are idempotent and whose reads never leave the owner
 */
export function createRecordMessageRepository(
  tx: Transaction,
  ownerId: string,
): RecordMessageRepository {
  async function assertAccessible(
    recordId: string,
    editDraftId: string,
  ): Promise<void> {
    const [record, draft] = await Promise.all([
      tx.records.findFirst({
        where: { id: recordId, ownerId },
        select: { id: true },
      }),
      tx.editDraftRuns.findFirst({
        where: { id: editDraftId, ownerId, recordId },
        select: { id: true },
      }),
    ]);
    if (!record || !draft) {
      throw new Error('Record message dependencies are inaccessible');
    }
  }

  async function readStored(
    condition: Prisma.recordMessagesWhereInput,
    what: string,
  ): Promise<recordMessages> {
    const existing = await tx.recordMessages.findFirst({
      where: { ownerId, ...condition },
    });
    if (!existing) {
      throw new Error(`The ${what} vanished after a conflicting insert`);
    }

    return existing;
  }

  return {
    /** @param input */
    async insertCollectorMessage(input) {
      const body = requireBody(input.body, 'Collector message');
      await assertAccessible(input.recordId, input.editDraftId);
      const [inserted] = await tx.$queryRaw<recordMessages[]>`
        insert into record_messages (id, owner_id, record_id, author, body, edit_draft_id, request_key, created_at)
        values (${input.id}::uuid, ${ownerId}, ${input.recordId}::uuid, 'collector', ${body},
          ${input.editDraftId}::uuid, ${input.requestKey}, ${iso(input.createdAt)}::timestamptz)
        on conflict (owner_id, request_key) do nothing
        returning id, owner_id as "ownerId", record_id as "recordId", author, body,
          edit_draft_id as "editDraftId", request_key as "requestKey", created_at as "createdAt"`;
      if (inserted) {
        return { message: toMessage(inserted), created: true };
      }
      const existing = await readStored(
        { requestKey: input.requestKey },
        'collector message',
      );
      if (
        existing.recordId !== input.recordId ||
        existing.editDraftId !== input.editDraftId ||
        existing.body !== body
      ) {
        throw new RecordMessageReplayConflictError();
      }

      return { message: toMessage(existing), created: false };
    },
    /** @param input */
    async insertAssistantReply(input) {
      const body = requireBody(input.body, 'Assistant reply');
      await assertAccessible(input.recordId, input.editDraftId);
      const draft = await tx.editDraftRuns.findFirstOrThrow({
        where: { id: input.editDraftId, ownerId, recordId: input.recordId },
        select: { knowledgeContext: true, result: true },
      });
      const evidence =
        draft.knowledgeContext === null
          ? null
          : knowledgeEvidenceSnapshotV1Schema.parse(draft.knowledgeContext);
      const result =
        draft.result === null
          ? null
          : editDraftResultSchema.parse(draft.result);
      const [inserted] = await tx.$queryRaw<recordMessages[]>`
        insert into record_messages (id, owner_id, record_id, author, body, edit_draft_id, request_key, created_at, knowledge_evidence)
        values (${input.id}::uuid, ${ownerId}, ${input.recordId}::uuid, 'assistant', ${body},
          ${input.editDraftId}::uuid, null, ${iso(input.createdAt)}::timestamptz, ${evidence === null ? null : JSON.stringify(evidence)}::jsonb)
        on conflict (edit_draft_id) where author = 'assistant' do nothing
        returning id, owner_id as "ownerId", record_id as "recordId", author, body,
          edit_draft_id as "editDraftId", request_key as "requestKey", created_at as "createdAt", knowledge_evidence as "knowledgeEvidence"`;
      if (inserted) {
        return {
          message: {
            ...toMessage(inserted),
            answerSegments: result?.answerSegments ?? [],
          },
          created: true,
        };
      }
      const existing = await readStored(
        { editDraftId: input.editDraftId, author: 'assistant' },
        'assistant reply',
      );

      return { message: toMessage(existing), created: false };
    },
    /** @param editDraftId */
    async findCollectorMessage(editDraftId) {
      const row = await tx.recordMessages.findFirst({
        where: { ownerId, editDraftId, author: 'collector' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

      return row ? toMessage(row) : null;
    },
    /**
     * @param root0
     * @param root0.recordId
     * @param root0.cursor
     * @param root0.limit
     */
    async listByRecord({ recordId, cursor, limit }) {
      const size = Math.min(
        Math.max(limit ?? DEFAULT_PAGE_SIZE, 1),
        MAX_PAGE_SIZE,
      );
      const position = cursor ? decodeCursor(cursor) : null;
      const persisted = await tx.recordMessages.findMany({
        where: {
          ownerId,
          recordId,
          editDraftRuns: { is: { ownerId, jobs: { ownerId } } },
          ...(position
            ? {
                OR: [
                  { createdAt: { lt: position.createdAt } },
                  { createdAt: position.createdAt, id: { lt: position.id } },
                ],
              }
            : {}),
        },
        include: { editDraftRuns: { include: { jobs: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: size + 1,
      });
      const rows = persisted.map((message) => ({
        message,
        draft: message.editDraftRuns,
        jobState: message.editDraftRuns.jobs.state,
      }));
      const page = rows.slice(0, size);
      const skipped = await listSkippedProposalIds(
        tx,
        ownerId,
        page.map(({ draft }) => draft.id),
      );
      const newestFirst = page.map(
        ({ message, draft, jobState }): ListedRecordMessage => {
          const facts = draftSchema.parse({
            status: draft.status,
            revision: draft.revision,
            result: draft.result,
            appliedProposalIds: draft.appliedProposalIds,
          });

          return {
            message: {
              ...toMessage(message),
              ...(message.author === 'assistant'
                ? { answerSegments: facts.result?.answerSegments ?? [] }
                : {}),
            },
            draft: {
              status: facts.status,
              revision: facts.revision,
              proposedChanges: facts.result?.proposedChanges ?? [],
              appliedProposalIds: facts.appliedProposalIds,
              skippedProposalIds: inProposalOrder(
                facts.result,
                skipped.get(draft.id) ?? [],
              ),
              jobFailed: jobState === 'failed',
            },
          };
        },
      );

      const nextCursor =
        rows.length > size ? encodeCursor(newestFirst.at(-1)!.message) : null;

      return { items: newestFirst.toReversed(), nextCursor };
    },
  };
}
