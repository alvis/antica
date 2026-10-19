import { analysisRunDetailSchema } from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { AnalysisRunDetail } from '@antica/contracts';

/** polling interval while a run is queued or running */
const runningPollMilliseconds = 3000;

/**
 * tells whether a run is still waiting for or producing its result
 * @param status lifecycle stage reported for the run
 * @returns whether the run has not finished
 */
export function isRunInProgress(
  status: AnalysisRunDetail['status'] | undefined,
): boolean {
  return status === 'queued' || status === 'running';
}

/**
 * describes one analysis run, polled until it finishes
 * @param api authenticated API transport
 * @param runId run to read
 * @returns query options shared by the analysis screen and the record's analysis state
 */
export function analysisRunQuery(
  api: ApiTransport,
  runId: string,
): UseQueryOptions<AnalysisRunDetail> {
  return {
    queryKey: ['analysis', runId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/analyses/${runId}`, analysisRunDetailSchema, signal),
    refetchInterval: (query) =>
      isRunInProgress(query.state.data?.status)
        ? runningPollMilliseconds
        : false,
  };
}
