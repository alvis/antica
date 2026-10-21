import { describe, expect, it } from 'vitest';

import { recordPatchSchema } from '@antica/contracts';

import { adoptedFields, recordFieldsOf } from './fields.js';

import type { ProposedChange, RecordDetail } from '@antica/contracts';

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
      condition: 'Chipped rim',
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
      | 'condition'
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

const proposalId = '00000000-0000-4000-8000-000000000009';
const diameter = { value: 21.8, unit: 'cm' } as const;
const height = { value: 4.2, unit: 'cm' } as const;

describe('fn:adoptedFields', () => {
  it('should clear every measurement a dimensions proposal leaves out', () => {
    const change: ProposedChange = {
      id: proposalId,
      findingIds: [],
      field: 'dimensions',
      before: { height },
      proposed: { diameter },
    };

    const result = adoptedFields(change);

    expect(result).toEqual({
      dimensions: {
        height: null,
        width: null,
        depth: null,
        diameter,
        seatHeight: null,
        weight: null,
      },
    });
    expect(
      recordPatchSchema.parse(
        JSON.parse(JSON.stringify({ expectedRevision: 1, fields: result })),
      ).fields,
    ).toEqual(result);
  });

  it('should write any other proposal as its field alone', () => {
    const change: ProposedChange = {
      id: proposalId,
      findingIds: [],
      field: 'condition',
      before: null,
      proposed: '椅面藤屜已換',
    };

    expect(adoptedFields(change)).toEqual({ condition: '椅面藤屜已換' });
  });
});
