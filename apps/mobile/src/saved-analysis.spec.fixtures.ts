import {
  analysisOutputSchema,
  analysisRunDetailSchema,
} from '@antica/contracts';

import { collectionRecord } from './mobile.spec.fixtures';

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

export const evidenceId = '10000000-0000-4000-8000-000000000070';
export const observationId = '20000000-0000-4000-8000-000000000071';
export const citationId = '30000000-0000-4000-8000-000000000072';
export const pageId = '40000000-0000-4000-8000-000000000073';
export const sourceId = '50000000-0000-4000-8000-000000000074';
export const versionId = '60000000-0000-4000-8000-000000000075';

const referencedRunSchema = analysisRunDetailSchema.extend({
  result: analysisRunDetailSchema.shape.result.extend({
    output: analysisOutputSchema,
  }),
});

/**
 * creates a saved analysis read with references to the supplied media asset
 * @param assetId existing media asset referenced by the saved snapshot
 * @returns saved analysis with its original findings and citations
 */
export function createReferencedRun(
  assetId: string,
): ReturnType<typeof referencedRunSchema.parse> {
  return referencedRunSchema.parse({
    ...run,
    snapshot: { ...run.snapshot, assetIds: [assetId] },
    citations: [
      {
        id: citationId,
        relation: 'supports',
        availability: 'stored',
        verification: 'located',
        locator: {
          kind: 'page',
          sourceId,
          sourceVersionId: versionId,
          pageId,
          pageIndex: 1,
          printedPageLabel: null,
          canonicalViewId: pageId,
          regionId: null,
          region: null,
          textRange: null,
        },
      },
    ],
    result: {
      ...run.result,
      output: {
        ...run.result.output,
        findings: [
          {
            id: runId,
            kind: 'visualObservation',
            text: 'Mixed supporting references',
            evidenceIds: [evidenceId],
            observationIds: [observationId],
            citationIds: [citationId],
            relation: 'supports',
            certainty: 'observed',
          },
        ],
      },
    },
  });
}
