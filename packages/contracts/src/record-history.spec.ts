import { describe, expect, it } from 'vitest';

import {
  recordHistoryEntrySchema,
  recordHistoryQuerySchema,
} from './record-history.js';

const id = '00000000-0000-4000-8000-000000000001';
const occurredAt = '2026-10-17T01:00:00.000Z';

describe('record history entry validation', () => {
  it('should accept entries linked to an analysis run or an edit draft', () => {
    expect(
      recordHistoryEntrySchema.safeParse({
        id,
        occurredAt,
        field: 'name',
        before: 'Vase',
        after: 'Blue vase',
        status: 'accepted',
        source: { kind: 'analysis', runId: id, proposalId: id },
      }).success,
    ).toBe(true);
    expect(
      recordHistoryEntrySchema.safeParse({
        id,
        occurredAt,
        field: 'tags',
        before: [],
        after: ['blue'],
        status: 'skipped',
        source: {
          kind: 'editDraft',
          editDraftId: id,
          proposalId: id,
          recordMessageId: null,
        },
      }).success,
    ).toBe(true);
  });

  it('should reject values that do not match the field or an unlinked source', () => {
    expect(
      recordHistoryEntrySchema.safeParse({
        id,
        occurredAt,
        field: 'tags',
        before: 'Vase',
        after: ['blue'],
        status: 'accepted',
        source: { kind: 'analysis', runId: id, proposalId: id },
      }).success,
    ).toBe(false);
    expect(
      recordHistoryEntrySchema.safeParse({
        id,
        occurredAt,
        field: 'name',
        before: 'Vase',
        after: 'Blue vase',
        status: 'accepted',
        source: { kind: 'editDraft', editDraftId: id, proposalId: id },
      }).success,
    ).toBe(false);
  });
});

describe('record history query validation', () => {
  it('should bound the page size and require a non-empty cursor', () => {
    expect(recordHistoryQuerySchema.safeParse({ limit: 100 }).success).toBe(
      true,
    );
    expect(recordHistoryQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
    expect(recordHistoryQuerySchema.safeParse({ cursor: '' }).success).toBe(
      false,
    );
  });
});
