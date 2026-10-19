import { z } from 'zod';

import { InvalidCursorError } from '@antica/application/ports';
import { MAX_PAGE_SIZE, recordHistoryEntrySchema } from '@antica/contracts';

import { Prisma } from '../generated/client.js';

import type {
  CursorPage,
  RecordHistoryEntry,
  RecordHistoryQuery,
} from '@antica/contracts';

import type { Transaction } from '../transaction.js';

const DEFAULT_PAGE_SIZE = 50;

/** exact database position; the ISO timestamp keeps microsecond precision */
const cursorSchema = z.strictObject({
  occurredAt: z.iso.datetime(),
  id: z.uuid(),
});
type HistoryCursor = z.infer<typeof cursorSchema>;

const rowSchema = z.object({
  id: z.string(),
  occurred_at: z.string(),
  position: z.string(),
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  status: z.string(),
  kind: z.enum(['analysis', 'editDraft']),
  source_id: z.string(),
  proposal_id: z.string(),
  record_message_id: z.string().nullable(),
});
type HistoryRow = z.infer<typeof rowSchema>;

/**
 * decodes an opaque history cursor
 * @param value base64url cursor returned by a previous page
 * @returns database position after which the next page starts
 * @throws {InvalidCursorError} when the cursor is not a history position
 */
function decodeCursor(value: string): HistoryCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new InvalidCursorError();
  }

  return parsed.data;
}

/**
 * encodes a history position as an opaque cursor
 * @param cursor database position of the last returned entry
 * @returns base64url cursor
 */
function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/**
 * maps one union row to its public entry
 * @param row adoption event joined with its proposal values
 * @returns validated history entry linked to its proposing suggestion
 */
function toEntry(row: HistoryRow): RecordHistoryEntry {
  return recordHistoryEntrySchema.parse({
    id: row.id,
    occurredAt: row.occurred_at,
    field: row.field,
    before: row.before,
    after: row.after,
    status: row.status,
    source:
      row.kind === 'analysis'
        ? {
            kind: 'analysis',
            runId: row.source_id,
            proposalId: row.proposal_id,
          }
        : {
            kind: 'editDraft',
            editDraftId: row.source_id,
            proposalId: row.proposal_id,
            recordMessageId: row.record_message_id,
          },
  });
}

/**
 * reads one owner's adoption decisions for a record from both suggestion flows
 * @param scope transaction and collector whose history may be read
 * @param scope.tx transaction shared with the enclosing owner-scoped operation
 * @param scope.ownerId collector whose history may be read
 * @param recordId record whose history is requested
 * @param query opaque cursor and page size
 * @returns entries ordered newest first and the cursor of the next page
 * @throws {InvalidCursorError} when the cursor is malformed or tampered with
 * @throws {z.ZodError} when a stored row breaks the public entry schema; corrupt history fails loudly instead of being dropped from the page
 */
export async function queryRecordHistory(
  { tx, ownerId }: { readonly tx: Transaction; readonly ownerId: string },
  recordId: string,
  query: RecordHistoryQuery,
): Promise<CursorPage<RecordHistoryEntry>> {
  const size = Math.min(query.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const after = cursor
    ? Prisma.sql`where (history.occurred_at, history.id) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`
    : Prisma.sql``;
  const result = await tx.$queryRaw<unknown[]>(Prisma.sql`
    select history.id,
      to_char(history.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
      to_char(history.occurred_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as position, history.field, history.before,
      history.after, history.status, history.kind, history.source_id,
      history.proposal_id, history.record_message_id
    from (
      select event.id, event.created_at as occurred_at, proposal.field,
        proposal.before, proposal.proposed as after, event.status,
        'analysis' as kind, event.run_id as source_id, event.proposal_id,
        null::uuid as record_message_id
      from adoption_events event
      inner join analysis_runs run
        on run.id = event.run_id
        and run.owner_id = ${ownerId}
        and run.record_id = ${recordId}
      inner join proposals proposal
        on proposal.id = event.proposal_id
        and proposal.run_id = event.run_id
      union all
      select event.id, event.created_at as occurred_at, event.field,
        event.before, event.after, event.status, 'editDraft' as kind,
        event.edit_draft_id as source_id, event.proposal_id,
        (
          select message.id
          from record_messages message
          where message.owner_id = ${ownerId}
            and message.edit_draft_id = event.edit_draft_id
            and message.author = 'collector'
          order by message.created_at, message.id
          limit 1
        ) as record_message_id
      from edit_draft_adoption_events event
      where event.owner_id = ${ownerId} and event.record_id = ${recordId}
    ) history
    ${after}
    order by history.occurred_at desc, history.id desc
    limit ${size + 1}
  `);
  const rows = z.array(rowSchema).parse([...result]);
  const page = rows.slice(0, size);

  return {
    items: page.map(toEntry),
    nextCursor:
      rows.length > size
        ? encodeCursor({
            occurredAt: page.at(-1)!.position,
            id: page.at(-1)!.id,
          })
        : null,
  };
}
