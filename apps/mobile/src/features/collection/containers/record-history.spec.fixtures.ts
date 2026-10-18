import { recordHistoryEntrySchema } from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';

import type { RecordHistoryEntry } from '@antica/contracts';

export const historyPath = `/v1/records/${collectionRecord.id}/history`;
export const historyRunId = '00000000-0000-4000-8000-000000000910';
export const historyProposalId = '00000000-0000-4000-8000-000000000911';
export const historyDraftId = '00000000-0000-4000-8000-000000000912';
export const historyMaterialId = '00000000-0000-4000-8000-000000000913';

const analysisSource = {
  kind: 'analysis',
  runId: historyRunId,
  proposalId: historyProposalId,
} as const;
const draftSource = {
  kind: 'editDraft',
  editDraftId: historyDraftId,
  proposalId: historyProposalId,
  recordMessageId: null,
} as const;

/**
 * builds one contract-valid history entry
 * @param id entry identifier, unique within a test
 * @param change field, values, status, and source of the decision
 * @returns a parsed history entry
 */
export function historyEntry(
  id: string,
  change: Record<string, unknown>,
): RecordHistoryEntry {
  return recordHistoryEntrySchema.parse({
    id,
    occurredAt: '2026-10-16T09:30:00.000Z',
    status: 'accepted',
    source: analysisSource,
    ...change,
  });
}

export const renamed = historyEntry('00000000-0000-4000-8000-000000000901', {
  field: 'name',
  before: null,
  after: 'Blue-and-white vase',
});
export const longDescription =
  'A tall porcelain vase painted in cobalt blue with scrolling lotus, a band of ruyi heads at the shoulder, and light wear around the unglazed foot ring.';
export const describedByVoice = historyEntry(
  '00000000-0000-4000-8000-000000000902',
  {
    field: 'description',
    status: 'skipped',
    source: draftSource,
    before: '',
    after: longDescription,
  },
);
export const dated = historyEntry('00000000-0000-4000-8000-000000000903', {
  field: 'period',
  before: { label: 'Qing', status: 'unconfirmed' },
  after: {
    label: 'Kangxi',
    fromYear: 1662,
    toYear: 1722,
    status: 'collectorClaim',
  },
});
export const datedFrom = historyEntry('00000000-0000-4000-8000-000000000904', {
  field: 'period',
  before: null,
  after: { label: 'Late Qing', fromYear: 1850, status: 'unconfirmed' },
});
export const tagged = historyEntry('00000000-0000-4000-8000-000000000905', {
  field: 'tags',
  before: [],
  after: ['vase', 'porcelain'],
});
export const material = historyEntry('00000000-0000-4000-8000-000000000906', {
  field: 'materialIds',
  before: [],
  after: [historyMaterialId],
});
export const judged = historyEntry('00000000-0000-4000-8000-000000000907', {
  field: 'collectorJudgment',
  before: 'Possibly later',
  after: null,
});
export const datedUntil = historyEntry('00000000-0000-4000-8000-000000000908', {
  field: 'period',
  before: null,
  after: { label: 'Early Qing', toYear: 1700, status: 'unconfirmed' },
});
