import { describe, expect, it } from 'vitest';

import {
  periodSchema,
  recordFieldsSchema,
  recordPatchSchema,
} from './record.js';

const id = '00000000-0000-4000-8000-000000000001';
const fields = {
  name: 'Vase',
  unitKind: 'single',
  components: [],
  pieceCount: 1,
  categoryIds: [],
  materialIds: [],
  period: null,
  dimensions: {},
  location: { locationId: null, detail: '' },
  acquisition: { receiptAssetIds: [] },
  tags: [],
  description: '',
  collectorJudgment: null,
} as const;

describe('record period validation', () => {
  it('should accept open and ordered year ranges while rejecting reversed years', () => {
    const base = { label: 'Ming', status: 'unconfirmed' };

    expect(periodSchema.safeParse(base).success).toBe(true);
    expect(periodSchema.safeParse({ ...base, fromYear: 1500 }).success).toBe(
      true,
    );
    expect(periodSchema.safeParse({ ...base, toYear: 1600 }).success).toBe(
      true,
    );
    expect(
      periodSchema.safeParse({ ...base, fromYear: 1500, toYear: 1600 }).success,
    ).toBe(true);
    expect(
      periodSchema.safeParse({ ...base, fromYear: 1600, toYear: 1500 }).success,
    ).toBe(false);
  });
});

describe('record field validation', () => {
  it('should require amount and currency together for an acquisition', () => {
    expect(recordFieldsSchema.safeParse(fields).success).toBe(true);
    expect(
      recordFieldsSchema.safeParse({
        ...fields,
        acquisition: { receiptAssetIds: [], amount: '12.50' },
      }).success,
    ).toBe(false);
    expect(
      recordFieldsSchema.safeParse({
        ...fields,
        acquisition: { receiptAssetIds: [], currency: 'GBP' },
      }).success,
    ).toBe(false);
    expect(
      recordFieldsSchema.safeParse({
        ...fields,
        acquisition: { receiptAssetIds: [], amount: '12.50', currency: 'GBP' },
      }).success,
    ).toBe(true);
  });
});

describe('record patch validation', () => {
  it('should bind accepted proposals to the draft they came from', () => {
    const base = { expectedRevision: 1, fields: {} };

    expect(recordPatchSchema.safeParse(base).success).toBe(true);
    expect(
      recordPatchSchema.safeParse({ ...base, editDraftId: id }).success,
    ).toBe(false);
    expect(
      recordPatchSchema.safeParse({ ...base, acceptedProposalIds: [id] })
        .success,
    ).toBe(false);
    expect(
      recordPatchSchema.safeParse({
        ...base,
        editDraftId: id,
        acceptedProposalIds: [id],
      }).success,
    ).toBe(true);
  });
});
