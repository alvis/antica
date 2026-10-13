import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';

export const conflictStatus = 409;
export const runId = '00000000-0000-4000-8000-000000000010';
export const firstProposalId = '00000000-0000-4000-8000-000000000011';
export const secondProposalId = '00000000-0000-4000-8000-000000000012';
export const run = analysisRunDetailSchema.parse({
  runId,
  recordId: collectionRecord.id,
  jobId: runId,
  status: 'completed',
  snapshot: {
    id: runId,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    assetIds: [],
    evidenceIds: [],
    observationIds: [],
    checkIds: [],
    retrievalSnapshotId: null,
  },
  citations: [],
  suggestedMethods: [],
  invocation: null,
  failureAudits: [],
  result: {
    actionStates: [],
    proposalStates: [],
    output: {
      summary: 'Two suggestions require collector approval.',
      findings: [],
      uncertainties: [],
      suggestedMethodIds: [],
      nextActions: [],
      proposedChanges: [
        {
          id: firstProposalId,
          field: 'name',
          before: null,
          proposed: 'Blue vase',
          findingIds: [],
        },
        {
          id: secondProposalId,
          field: 'description',
          before: '',
          proposed: 'Floral decoration',
          findingIds: [],
        },
      ],
    },
  },
});

export const actionId = '00000000-0000-4000-8000-000000000013';
export const actionableRun = analysisRunDetailSchema.parse({
  ...run,
  result: {
    ...run.result,
    actionStates: [
      {
        runId,
        actionId,
        recordId: collectionRecord.id,
        revision: 1,
        status: 'pending',
        latestResolutionId: null,
        updatedAt: collectionRecord.updatedAt,
      },
    ],
    output: {
      ...run.result.output,
      nextActions: [
        {
          id: actionId,
          kind: 'describe',
          instruction: 'Describe the base',
          reason: 'The base is not visible',
        },
      ],
    },
  },
});
