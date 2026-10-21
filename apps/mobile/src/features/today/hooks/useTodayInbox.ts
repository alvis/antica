import { useQueries, useQuery } from '@tanstack/react-query';

import {
  MAX_PAGE_SIZE,
  recordPageSchema,
  taskPageSchema,
} from '@antica/contracts';

import { jobStatusQuery } from '../../../adapters/transcription';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';
import { recordTitle } from '../../../utils/record-title';

import { analysisRunQuery } from '../../analysis/api/analysis-run-query';
import { recordQuery } from '../../collection/api/record-query';
import { recordMessageInboxQuery } from '../../collection/messages/api/record-messages';

import { buildTodayInbox } from '../today-inbox';

import type { UseQueryResult } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type {
  AnalysisRunDetail,
  RecordDetail,
  RecordSummary,
} from '@antica/contracts';

import type { TodayInboxItem, TodayRecordState } from '../today-inbox';

/** the newest records 今天 checks for waiting work and shows on its shelf */
const recentRecordLimit = 12;

/** a record whose finished analysis 今日知識 can relate an entry to */
export interface AnalysedRecord {
  readonly recordId: string;
  readonly name: string;
  readonly recordRevision: number;
  /** what the analysis asks the collector to do next, such as 拍攝底足與支釘痕 */
  readonly nextStep?: string;
}

/** what 今天 shows: the waiting cards, the recent shelf and the latest analysed record */
export interface TodayInbox {
  readonly items: readonly TodayInboxItem[];
  /** recent records, newest first, with when each was added once its detail is read */
  readonly records: ReadonlyArray<{
    readonly summary: RecordSummary;
    readonly createdAt?: string;
  }>;
  /** how many records the collector holds, or null while a longer collection is still counted */
  readonly recordCount: number | null;
  /** the newest record with a finished analysis, for 今日知識 */
  readonly analysed: AnalysedRecord | null;
  /** whether the records page or the tasks are still read */
  readonly loading: boolean;
  /** why the records page or the tasks could not be read */
  readonly error: Error | null;
  /** whether a recent record's detail, run or conversation is still read, so cards may follow */
  readonly settling: boolean;
  /** why a recent record's detail, run or conversation could not be read, so cards may be missing */
  readonly partialError: Error | null;
  /** rereads whatever failed */
  readonly retry: () => void;
}

/**
 * reads the recent records, their latest runs, conversations and the pending tasks, and
 * builds 等您處理 from them. The server has no inbox read, so a mount costs the records page and
 * the tasks, then per recent record its detail and conversation, and per finished run the run
 * and its job: up to 2 + 4 × 12 reads in three waves, shared with the record hub's cache
 * @returns the inbox, the shelf and their loading state
 */
export function useTodayInbox(): TodayInbox {
  const { api } = useAuth();
  const { t } = useLocale();
  const records = useQuery({
    queryKey: ['records', 'today'],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/records?limit=${recentRecordLimit}&sort=updated`,
        recordPageSchema,
        signal,
      ),
  });
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async ({ signal }) =>
      api.get('/v1/tasks?limit=50', taskPageSchema, signal),
  });
  const summaries = records.data?.items ?? [];
  const details = useQueries({
    queries: summaries.map((summary) => recordQuery(api, summary.id)),
  });
  const runIds = details.flatMap((detail) =>
    detail.data?.latestRunId ? [detail.data.latestRunId] : [],
  );
  const runQueries = useQueries({
    queries: runIds.map((runId) => analysisRunQuery(api, runId)),
  });
  const runsById = new Map(
    runQueries.flatMap((run) => (run.data ? [[run.data.runId, run.data]] : [])),
  );
  const finishedRuns = [...runsById.values()].filter(
    (run) => run.status === 'completed' || run.status === 'partial',
  );
  const jobQueries = useQueries({
    queries: finishedRuns.map((run) => jobStatusQuery(api, run.jobId)),
  });
  const completedAtByJobId = new Map(
    jobQueries.flatMap(({ data }) =>
      data?.state.kind === 'succeeded'
        ? [[data.id, data.state.completedAt]]
        : [],
    ),
  );
  const runOf = (index: number): AnalysisRunDetail | undefined => {
    const runId = details[index]?.data?.latestRunId;

    return runId ? runsById.get(runId) : undefined;
  };
  const conversations = useQueries({
    queries: summaries.map((summary) =>
      recordMessageInboxQuery(api, summary.id),
    ),
  });
  const states: TodayRecordState[] = summaries.map((summary, index) => {
    const run = runOf(index);

    return {
      summary,
      run,
      runCompletedAt: run ? completedAtByJobId.get(run.jobId) : undefined,
      entries: conversations[index]?.data?.items ?? [],
    };
  });

  const recordCount = useRecordCount(api, records.data);
  // the reads that decide which cards wait; a run's job only dates its card, so it never holds
  // back or casts doubt on what 今天 says waits
  const deciding: readonly UseQueryResult[] = [
    ...details,
    ...runQueries,
    ...conversations,
  ];
  const items = buildTodayInbox(states, tasks.data?.items ?? [], t('unnamed'));
  // the record whose analysis just finished comes first; otherwise the newest analysed one
  const justAnalysed = items.find((item) => item.kind === 'analysis');

  return {
    items,
    records: summaries.map((summary, index) => ({
      summary,
      createdAt: details[index]?.data?.createdAt,
    })),
    recordCount,
    analysed: newestAnalysed(
      details.map((detail) => detail.data),
      summaries.map((_, index) => runOf(index)),
      justAnalysed?.recordId,
      t('unnamed'),
    ),
    loading: records.isPending || tasks.isPending,
    error: records.error ?? tasks.error,
    settling: deciding.some((query) => query.isPending),
    partialError: deciding.find((query) => query.error)?.error ?? null,
    retry: () => {
      for (const query of [records, tasks, ...deciding, ...jobQueries]) {
        if (query.isError) {
          void query.refetch();
        }
      }
    },
  };
}

/**
 * counts the collector's records: the first page when it is the only one, otherwise every page
 * read at the largest size, as the server returns no total
 * @param api authenticated API transport
 * @param firstPage the newest records page, once read
 * @param firstPage.items the records on it
 * @param firstPage.nextCursor where the next page starts, or null on the last page
 * @returns the count, or null until it is known
 */
function useRecordCount(
  api: ApiTransport,
  firstPage:
    | { readonly items: readonly unknown[]; readonly nextCursor: string | null }
    | undefined,
): number | null {
  const more = firstPage !== undefined && firstPage.nextCursor !== null;
  const total = useQuery({
    queryKey: ['records', 'count'],
    enabled: more,
    queryFn: async ({ signal }) => {
      let count = 0;
      let cursor: string | null = '';
      while (cursor !== null) {
        const page: {
          readonly items: readonly RecordSummary[];
          readonly nextCursor: string | null;
        } = await api.get(
          cursor
            ? `/v1/records?limit=${MAX_PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`
            : `/v1/records?limit=${MAX_PAGE_SIZE}`,
          recordPageSchema,
          signal,
        );
        count += page.items.length;
        cursor = page.nextCursor;
      }

      return count;
    },
  });

  if (firstPage === undefined) {
    return null;
  }

  return more ? (total.data ?? null) : firstPage.items.length;
}

/**
 * finds the record 今日知識 relates to: the one whose suggestions just arrived, else the newest analysed
 * @param details record details in shelf order, newest first
 * @param runs each record's latest run
 * @param preferredId the record with fresh suggestions, if any
 * @param unnamed localized title for records without a saved name
 * @returns that record and its next step, or null while none has finished
 */
function newestAnalysed(
  details: ReadonlyArray<RecordDetail | undefined>,
  runs: ReadonlyArray<AnalysisRunDetail | undefined>,
  preferredId: string | undefined,
  unnamed: string,
): AnalysedRecord | null {
  const preferred = details.findIndex((detail) => detail?.id === preferredId);
  const index =
    preferred >= 0
      ? preferred
      : runs.findIndex(
          (run) => run?.status === 'completed' || run?.status === 'partial',
        );
  const detail = details[index];
  const nextActions = runs[index]?.result.output?.nextActions ?? [];
  // a photo to take is the step 今日知識 can help with most; otherwise the first step
  const nextAction =
    nextActions.find((action) => action.kind === 'capturePhoto') ??
    nextActions.at(0);

  return detail
    ? {
        recordId: detail.id,
        name: recordTitle(detail.name, unnamed),
        recordRevision: detail.recordRevision,
        nextStep: nextAction?.instruction,
      }
    : null;
}
