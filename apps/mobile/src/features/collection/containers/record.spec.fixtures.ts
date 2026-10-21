import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';
import { run } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

export const observationId = '00000000-0000-4000-8000-000000000054';
export const sourceId = '00000000-0000-4000-8000-000000000055';
export const sourceVersionId = '00000000-0000-4000-8000-000000000056';
export const pageId = '00000000-0000-4000-8000-000000000057';

export const savedReferences = [
  {
    id: '00000000-0000-4000-8000-000000000058',
    noteZhHant: '',
    reference: {
      kind: 'collection',
      recordId: collectionRecord.id,
      originalAssetId: media.asset.id,
      evidenceAnchorId: null,
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000059',
    noteZhHant: 'Catalog page',
    reference: {
      kind: 'source',
      referenceImageId: null,
      locator: {
        kind: 'page',
        sourceId,
        sourceVersionId,
        pageId,
        pageIndex: 0,
        printedPageLabel: null,
        canonicalViewId: media.asset.views[0].id,
        regionId: null,
        region: null,
        textRange: null,
      },
    },
  },
  {
    id: '00000000-0000-4000-8000-000000000060',
    noteZhHant: 'Museum site',
    reference: {
      kind: 'source',
      referenceImageId: null,
      locator: {
        kind: 'web',
        sourceId,
        sourceVersionId,
        url: 'https://museum.example/bowl',
        retrievedAt: collectionRecord.createdAt,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      },
    },
  },
];

/** when the fixture analyses finished */
export const analysisCompletedAt = '2026-10-20T13:46:00.000Z';

/**
 * a finished analysis job, as the record hub reads it for the run's completion time
 * @param path the job read, such as /v1/jobs/<id>
 * @returns the succeeded job envelope
 */
export function analysisJob(path: string): unknown {
  const id = path.slice('/v1/jobs/'.length);

  return {
    id,
    kind: 'analysis',
    resourceId: id,
    state: { kind: 'succeeded', completedAt: analysisCompletedAt },
    createdAt: analysisCompletedAt,
    updatedAt: analysisCompletedAt,
    result: null,
  };
}

/**
 * a run that finished with nothing left to decide, so the record hub falls back to its
 * analysis state rather than to suggestions
 * @param runId identity the record's latest run points at
 * @param status how the run ended
 * @returns the run detail
 */
export function settledRun(
  runId: string,
  status:
    'completed' | 'partial' | 'failed' | 'queued' | 'running' = 'completed',
): ReturnType<typeof analysisRunDetailSchema.parse> {
  return analysisRunDetailSchema.parse({
    ...run,
    runId,
    jobId: runId,
    status,
    result: {
      ...run.result,
      output: { ...run.result.output, proposedChanges: [] },
    },
  });
}

/**
 * answers the record hub's own reads that a journey does not supply: a run settles with nothing
 * pending, its job finished, and tasks, conversations and other pages are empty
 * @param path the read
 * @returns the reply
 */
export function hubReads(path: string): unknown {
  if (path.startsWith('/v1/jobs/')) {
    return analysisJob(path);
  }
  if (path.startsWith('/v1/analyses/')) {
    return settledRun(path.slice('/v1/analyses/'.length));
  }

  return { items: [], nextCursor: null };
}
