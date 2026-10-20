import { jest } from '@jest/globals';

import { useLocalSearchParams } from 'expo-router';

import RecordRoute from '../../../app/(private)/collection/[recordId]';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import { hubReads, settledRun } from './record.spec.fixtures';

import type { RecordDetail } from '@antica/contracts';

/** photo the saved record shows */
export const mediaId = media.asset.id;
/** run a start request is answered with */
export const newRunId = '00000000-0000-4000-8000-000000000052';

/**
 * opens a saved record whose latest run, if any, has the given status and nothing left to decide
 * @param record record fields replacing the saved record's
 * @param runStatus status of the latest run
 * @returns the mobile harness
 */
export async function openRecord(
  record: Partial<RecordDetail>,
  runStatus:
    'queued' | 'running' | 'completed' | 'partial' | 'failed' = 'completed',
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const saved = { ...collectionRecord, mediaIds: [mediaId], ...record };

  return renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? saved
        : path === `/v1/analyses/${runId}`
          ? settledRun(runId, runStatus)
          : path === `/v1/media/${mediaId}`
            ? media
            : hubReads(path),
    post: async () => ({ runId: newRunId, jobId: newRunId }),
  });
}
