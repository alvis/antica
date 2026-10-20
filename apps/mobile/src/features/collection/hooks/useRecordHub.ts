import { useQuery } from '@tanstack/react-query';

import { taskPageSchema } from '@antica/contracts';

import { jobStatusQuery } from '../../../adapters/transcription';
import { useAuth } from '../../../providers/AuthProvider';

import { analysisRunQuery } from '../../analysis/api/analysis-run-query';

import { recordQuery } from '../api/record-query';
import { recordMessageInboxQuery } from '../messages/api/record-messages';
import { recordAnalysisState } from '../record-analysis-state';
import { pendingEditChanges, pendingProposals } from '../record-hub';

import { useRecordFieldLabels } from './useRecordFieldLabels';

import type { UseQueryResult } from '@tanstack/react-query';

import type {
  AnalysisRunDetail,
  InspectionTask,
  ProposedChange,
  RecordDetail,
} from '@antica/contracts';

import type { RecordAnalysisState } from '../record-analysis-state';

import type { RecordFieldLabels } from './useRecordFieldLabels';

/** what the record hub reads beside the record itself */
export interface RecordHub {
  readonly record: UseQueryResult<RecordDetail>;
  readonly fieldLabels: RecordFieldLabels;
  readonly run: UseQueryResult<AnalysisRunDetail>;
  readonly analysisState: RecordAnalysisState;
  /** when the latest run finished, once its job is read */
  readonly runCompletedAt?: string;
  /** the latest run's suggestions that wait on the collector */
  readonly suggestions: readonly ProposedChange[];
  /**
   * edit-card rows in the record's conversation that wait on the collector, among its newest
   * messages (recordMessageInboxQuery); a card further back in a long thread is not counted
   */
  readonly editChanges: readonly ProposedChange[];
  /** the record's pending inspection tasks */
  readonly tasks: readonly InspectionTask[];
}

/**
 * reads what the record hub decides its first action from: the record and its media labels,
 * the latest run with when it finished, the pending tasks, and the conversation's edit cards
 * @param recordId record on screen
 * @returns the hub's reads, each filled in as it arrives
 */
export function useRecordHub(recordId: string): RecordHub {
  const { api } = useAuth();
  const record = useQuery(recordQuery(api, recordId));
  const fieldLabels = useRecordFieldLabels({
    knowledgeIds: [
      ...(record.data?.categoryIds ?? []),
      ...(record.data?.materialIds ?? []),
    ],
    mediaIds: record.data?.mediaIds ?? [],
  });
  const latestRunId = record.data?.latestRunId;
  const run = useQuery({
    ...analysisRunQuery(api, latestRunId ?? ''),
    enabled: Boolean(latestRunId),
  });
  const finished =
    run.data?.status === 'completed' || run.data?.status === 'partial';
  // the run carries no completion time; its job does, under the key 今天 reads it with
  const job = useQuery({
    ...jobStatusQuery(api, run.data?.jobId ?? null),
    enabled: finished,
  });
  const tasks = useQuery({
    queryKey: ['tasks', recordId],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/tasks?recordId=${encodeURIComponent(recordId)}&actionStatus=pending&limit=20`,
        taskPageSchema,
        signal,
      ),
  });
  const conversation = useQuery(recordMessageInboxQuery(api, recordId));

  return {
    record,
    fieldLabels,
    run,
    analysisState: record.data
      ? recordAnalysisState(record.data, run.data?.status, run.isError)
      : 'unknown',
    runCompletedAt:
      job.data?.state.kind === 'succeeded'
        ? job.data.state.completedAt
        : undefined,
    suggestions: run.data ? pendingProposals(run.data) : [],
    editChanges: pendingEditChanges(conversation.data?.items ?? []),
    tasks: tasks.data?.items ?? [],
  };
}
