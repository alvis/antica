import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';

import { media, prepared } from '../media/media.spec.fixtures';

import { run, runId } from './analysis.spec.fixtures';

export const evidenceId = '10000000-0000-4000-8000-000000000070';
export const observationId = '20000000-0000-4000-8000-000000000071';
export const citationId = '30000000-0000-4000-8000-000000000072';
export const pageId = '40000000-0000-4000-8000-000000000073';
export const sourceId = '50000000-0000-4000-8000-000000000074';
export const versionId = '60000000-0000-4000-8000-000000000075';
export const mixed = analysisRunDetailSchema.parse({
  ...run,
  snapshot: { ...run.snapshot, assetIds: [media.asset.id] },
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
export const supported = {
  ...media,
  anchors: [
    {
      id: evidenceId,
      kind: 'video_frame',
      frame: prepared.frame,
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: media.asset.id,
      canonicalViewId: prepared.view.id,
      scope: { kind: 'whole' },
      createdAt: collectionRecord.createdAt,
    },
  ],
};
