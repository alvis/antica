import { fireEvent, screen } from '@testing-library/react-native';

import {
  analysisRunDetailSchema,
  jobStatusEnvelopeSchema,
} from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';
import { run, runId } from '../../../saved-analysis.spec.fixtures';

export const conflictStatus = 409;
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

/** the finished job of the saved run, which dates the 建議 header */
export const finishedJob = jobStatusEnvelopeSchema.parse({
  id: runId,
  kind: 'analysis',
  resourceId: runId,
  state: { kind: 'succeeded', completedAt: '2026-10-13T01:00:00.000Z' },
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T01:00:00.000Z',
  result: null,
});

/**
 * answers the job read the 建議 header makes, otherwise defers to the test's reads
 * @param read the test's own reads
 * @returns reads that also answer the run's job
 */
export function withFinishedJob(
  read: (path: string) => Promise<unknown>,
): (path: string) => Promise<unknown> {
  return async (path) =>
    path.startsWith('/v1/jobs/') ? finishedJob : read(path);
}

/**
 * opens the full analysis behind the suggestions, where findings, methods and actions live
 */
export async function openAnalysisDetails(): Promise<void> {
  await fireEvent.press(await screen.findByTestId('analysis-details-toggle'));
}
