import { analysisRunDetailSchema } from '@antica/contracts';

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
