import {
  knowledgeEvidenceSnapshotV1Schema,
  recordMessageEntrySchema,
} from '@antica/contracts';

import {
  relatedAttachment,
  relatedCard,
  relatedRecordId as recordId,
} from '../../../knowledge/containers/related-knowledge.spec.fixtures';

const sha256Length = 64;
const sourceId = '00000000-0000-4000-8000-000000000066';
export const historicalClaimId = '00000000-0000-4000-8000-000000000077';
export const historicalAnswer = {
  ...recordMessageEntrySchema.parse({
    id: '00000000-0000-4000-8000-000000000080',
    recordId,
    author: 'assistant',
    body: 'The earlier catalogue described a dark finish.',
    editDraftId: '00000000-0000-4000-8000-000000000501',
    createdAt: '2026-10-13T00:00:00.000Z',
    draft: {
      status: 'ready',
      revision: 4,
      proposedChanges: [],
      appliedProposalIds: [],
      skippedProposalIds: [],
    },
  }),
  knowledgeEvidence: knowledgeEvidenceSnapshotV1Schema.parse({
    schemaVersion: 1,
    snapshotId: '00000000-0000-4000-8000-000000000078',
    snapshotHash: 'b'.repeat(sha256Length),
    recordId,
    recordRevision: 1,
    corpusGeneration: 'historical',
    entries: [
      {
        entryId: relatedCard.entryId,
        revision: 2,
        contentHash: 'c'.repeat(sha256Length),
        title: 'Historical catalogue title',
        claims: [
          {
            claimId: historicalClaimId,
            claimKey: 'surface',
            statement: 'Historical dark finish',
            originalText: 'Historical dark finish',
            language: 'en',
            scope: { period: ['Qing'] },
            qualifiers: { condition: 'Daylight' },
            uncertainty: 'Later finish may affect appearance',
            sourceVersionIds: [sourceId],
            citations: [
              {
                citationId: relatedAttachment.citationIds[0],
                sourceId,
                sourceVersionId: sourceId,
                locatorId: '00000000-0000-4000-8000-000000000067',
                relation: 'supports',
                sourceTitle: 'Archived museum record',
                excerpt: 'The original captured quote.',
                provider: 'Museum archive',
              },
            ],
          },
        ],
      },
    ],
  }),
};
