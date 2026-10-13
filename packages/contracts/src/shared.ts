import { z } from 'zod';

import type { PublicError } from './error.js';

export const entityIdSchema = z.uuid();
export const instantSchema = z.iso.datetime({ offset: true });
export const revisionSchema = z.int().positive();
export const MAX_PAGE_SIZE = 100;
export const recordVersionsSchema = z.strictObject({
  recordRevision: revisionSchema,
  analysisInputVersion: revisionSchema,
  evidenceVersion: revisionSchema,
});
export const cursorPageSchema = <T extends z.ZodType>(
  item: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  nextCursor: z.ZodNullable<z.ZodString>;
}> =>
  z.strictObject({ items: z.array(item), nextCursor: z.string().nullable() });
export type CursorPage<T> = {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
};
export type PageState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly data: T }
  | { readonly kind: 'empty'; readonly reason: string }
  | { readonly kind: 'stale'; readonly data: T; readonly observedAt: string }
  | { readonly kind: 'error'; readonly error: PublicError };
