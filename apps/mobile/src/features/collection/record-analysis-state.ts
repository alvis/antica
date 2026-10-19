import type { AnalysisRunDetail, RecordDetail } from '@antica/contracts';

/** how a saved record stands against analysis (B06, C05) */
export type RecordAnalysisState =
  | 'unanalysed'
  | 'running'
  | 'analysed'
  | 'partial'
  | 'failed'
  | 'outdated'
  | 'unknown';

/**
 * derives the record's analysis state from its freshness and its latest run
 * @param record record freshness and latest run identifier
 * @param runStatus status of the latest run, when it has loaded
 * @param runFailed whether loading the latest run failed, for example offline or not found
 * @returns no run first, then a running run, an unloadable run, a failed run, new evidence, and a finished run
 */
export function recordAnalysisState(
  record: Pick<RecordDetail, 'latestRunId' | 'analysisFreshness'>,
  runStatus: AnalysisRunDetail['status'] | undefined,
  runFailed = false,
): RecordAnalysisState {
  if (!record.latestRunId) {
    return 'unanalysed';
  }
  if (runStatus === 'queued' || runStatus === 'running') {
    return 'running';
  }
  if (runStatus === undefined && runFailed) {
    // a run that cannot be read is never shown as still analysing
    return 'unknown';
  }
  if (runStatus === undefined && record.analysisFreshness === 'unanalyzed') {
    // a run exists but has no result yet, so it is still waiting or running
    return 'running';
  }
  if (runStatus === 'failed') {
    return 'failed';
  }
  if (record.analysisFreshness === 'outdated') {
    return 'outdated';
  }

  return runStatus === 'partial' ? 'partial' : 'analysed';
}
