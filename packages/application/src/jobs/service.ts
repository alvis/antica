import type { JobEnvelope } from '@antica/contracts';

import type { OperationResult, TransactionPort } from '../ports/index.js';

/** reads the durable collector-owned job state */
export interface JobService {
  get(ownerId: string, jobId: string): Promise<OperationResult<JobEnvelope>>;
}

/**
 * creates the job status query
 * @param transaction
 */
export function createJobService(transaction: TransactionPort): JobService {
  return {
    get: async (ownerId, jobId) =>
      transaction.run(ownerId, async (unit) => {
        const job = await unit.jobs.get(jobId);

        return job
          ? { success: true, data: job }
          : {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Job not found',
                retryable: false,
              },
            };
      }),
  };
}
