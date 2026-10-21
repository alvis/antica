import { z } from 'zod';

import { recordFieldsSchema } from './record.js';
import {
  cursorPageSchema,
  entityIdSchema,
  instantSchema,
  MAX_PAGE_SIZE,
} from './shared.js';

export const recordHistoryQuerySchema = z.strictObject({
  cursor: z.string().min(1).optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type RecordHistoryQuery = z.infer<typeof recordHistoryQuerySchema>;

/** links one adoption decision back to the suggestion that proposed it */
export const recordHistorySourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('analysis'),
    runId: entityIdSchema,
    proposalId: entityIdSchema,
  }),
  z.strictObject({
    kind: z.literal('editDraft'),
    editDraftId: entityIdSchema,
    proposalId: entityIdSchema,
    // set when the draft was requested from a record message; null otherwise
    recordMessageId: entityIdSchema.nullable(),
  }),
]);
export type RecordHistorySource = z.infer<typeof recordHistorySourceSchema>;

const entryBase = {
  id: entityIdSchema,
  occurredAt: instantSchema,
  status: z.enum(['accepted', 'skipped']),
  source: recordHistorySourceSchema,
};

/** one adopted or skipped field suggestion; before and after are the proposal's values */
export const recordHistoryEntrySchema = z.discriminatedUnion('field', [
  z.strictObject({
    ...entryBase,
    field: z.literal('name'),
    before: recordFieldsSchema.shape.name,
    after: recordFieldsSchema.shape.name,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('description'),
    before: recordFieldsSchema.shape.description,
    after: recordFieldsSchema.shape.description,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('materialIds'),
    before: recordFieldsSchema.shape.materialIds,
    after: recordFieldsSchema.shape.materialIds,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('period'),
    before: recordFieldsSchema.shape.period,
    after: recordFieldsSchema.shape.period,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('tags'),
    before: recordFieldsSchema.shape.tags,
    after: recordFieldsSchema.shape.tags,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('collectorJudgment'),
    before: recordFieldsSchema.shape.collectorJudgment,
    after: recordFieldsSchema.shape.collectorJudgment,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('surface'),
    before: recordFieldsSchema.shape.surface,
    after: recordFieldsSchema.shape.surface,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('categoryIds'),
    before: recordFieldsSchema.shape.categoryIds,
    after: recordFieldsSchema.shape.categoryIds,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('condition'),
    before: recordFieldsSchema.shape.condition,
    after: recordFieldsSchema.shape.condition,
  }),
  z.strictObject({
    ...entryBase,
    field: z.literal('dimensions'),
    before: recordFieldsSchema.shape.dimensions,
    after: recordFieldsSchema.shape.dimensions,
  }),
]);
export type RecordHistoryEntry = z.infer<typeof recordHistoryEntrySchema>;
export const recordHistoryPageSchema = cursorPageSchema(
  recordHistoryEntrySchema,
);
export type RecordHistoryPage = z.infer<typeof recordHistoryPageSchema>;
