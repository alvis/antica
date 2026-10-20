import { createHash } from 'node:crypto';

import { z } from 'zod';

const maximumCursorKeyLength = 200;

const cursorSchema = z.strictObject({
  binding: z.string(),
  generation: z.string(),
  lane: z.number().int(),
  score: z.number().finite(),
  support: z.number().int(),
  id: z.uuid(),
  key: z.string().max(maximumCursorKeyLength),
  sort: z.number().int(),
});
export type SearchCursor = z.infer<typeof cursorSchema>;

/**
 * binds a cursor to its owner, canonical filters and tokenizer
 * @param value complete immutable query context
 * @returns SHA-256 context identity
 */
export function cursorBinding(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/**
 * decodes an opaque bounded cursor without accepting another query's context
 * @param cursor opaque continuation supplied by client
 * @param binding required context identity
 * @returns validated continuation, null when absent, or false when invalid
 */
export function readSearchCursor(
  cursor: string | undefined,
  binding: string,
): SearchCursor | null | false {
  if (!cursor) {
    return null;
  }
  try {
    const parsed = cursorSchema.safeParse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    );

    return parsed.success && parsed.data.binding === binding
      ? parsed.data
      : false;
  } catch {
    return false;
  }
}
/**
 * encodes a continuation with its complete query and corpus identity
 * @param cursor verified keyset position
 * @returns opaque base64url cursor
 */
export function encodeSearchCursor(cursor: SearchCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}
