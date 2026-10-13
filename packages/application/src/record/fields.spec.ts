import { describe, expect, it } from 'vitest';

import { recordFieldsOf } from './fields.js';

import type { RecordDetail } from '@antica/contracts';

describe('fn:recordFieldsOf', () => {
  it('should project every editable field while excluding record lifecycle state', () => {
    const fields = {
      name: 'Blue vase',
      unitKind: 'single',
      components: [],
      pieceCount: 1,
      categoryIds: ['00000000-0000-4000-8000-000000000001'],
      materialIds: ['00000000-0000-4000-8000-000000000002'],
      period: { label: 'Ming', status: 'collectorClaim' },
      dimensions: { height: { value: 32, unit: 'cm' } },
      location: {
        locationId: '00000000-0000-4000-8000-000000000003',
        detail: 'Cabinet',
      },
      acquisition: {
        receiptAssetIds: ['00000000-0000-4000-8000-000000000004'],
        amount: '100',
        currency: 'USD',
      },
      tags: ['ceramic'],
      description: 'Glazed',
      collectorJudgment: 'Likely old',
    } satisfies Pick<
      RecordDetail,
      | 'name'
      | 'unitKind'
      | 'components'
      | 'pieceCount'
      | 'categoryIds'
      | 'materialIds'
      | 'period'
      | 'dimensions'
      | 'location'
      | 'acquisition'
      | 'tags'
      | 'description'
      | 'collectorJudgment'
    >;
    const record: RecordDetail = {
      ...fields,
      id: 'record-1',
      code: 'ANT-0001',
      recordRevision: 3,
      analysisInputVersion: 2,
      evidenceVersion: 4,
      createdAt: '2026-10-13T12:00:00.000Z',
      updatedAt: '2026-10-13T13:00:00.000Z',
      mediaIds: ['media-1'],
      checkIds: ['check-1'],
      latestRunId: 'run-1',
      analysisFreshness: 'outdated',
    };

    expect(recordFieldsOf(record)).toEqual(fields);
  });
});
