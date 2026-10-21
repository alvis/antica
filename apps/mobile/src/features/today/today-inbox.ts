import { recordTitle } from '../../utils/record-title';

import { pendingEditChanges, pendingProposals } from '../collection/record-hub';

import type {
  AnalysisRunDetail,
  InspectionTask,
  NextAction,
  ProposedChange,
  RecordMessageEntry,
  RecordSummary,
} from '@antica/contracts';

/** what 今天 knows about one recent record */
export interface TodayRecordState {
  readonly summary: RecordSummary;
  /** the record's latest analysis run, once read */
  readonly run?: AnalysisRunDetail;
  /** when that run finished, once its job is read */
  readonly runCompletedAt?: string;
  /** the newest page of the record's conversation */
  readonly entries: readonly RecordMessageEntry[];
}

/** fields shared by every inbox card */
interface InboxRecord {
  readonly recordId: string;
  /** the saved record name or a localized unnamed label */
  readonly name: string;
  readonly coverThumbnail: string | null;
}

/** one card of 等您處理; the collector decides each one, nothing is decided for them */
export type TodayInboxItem =
  | (InboxRecord & {
      /** an analysis finished with suggestions nobody has ticked or skipped */
      readonly kind: 'analysis';
      readonly runId: string;
      /** suggestions still waiting */
      readonly suggestionCount: number;
      /** every suggestion the run made, decided or not */
      readonly totalCount: number;
      readonly citationCount: number;
      readonly completedAt?: string;
    })
  | (InboxRecord & {
      /** an edit card in the conversation still has rows to confirm or skip */
      readonly kind: 'editCard';
      readonly changeCount: number;
      readonly fields: readonly ProposedChange['field'][];
    })
  | (InboxRecord & {
      /** the analysis asked for something only the collector can supply */
      readonly kind: 'action';
      readonly runId: string;
      readonly action: NextAction;
    });

/** card order: what the assistant finished, then what waits in a conversation, then requests */
const kindOrder = { analysis: 0, editCard: 1, action: 2 } as const;

/**
 * builds 等您處理 from the recent records, one card per record for its most pressing item
 * @param records recent records with their run and conversation, newest first
 * @param tasks pending inspection tasks of the collector
 * @param unnamed localized title for records without a saved name
 * @returns inbox cards in display order
 */
export function buildTodayInbox(
  records: readonly TodayRecordState[],
  tasks: readonly InspectionTask[],
  unnamed: string,
): TodayInboxItem[] {
  const items = records.flatMap((state) => {
    const item = recordInboxItem(state, tasks, unnamed);

    return item ? [item] : [];
  });

  return [...items].sort(
    (left, right) => kindOrder[left.kind] - kindOrder[right.kind],
  );
}

/**
 * picks the most pressing item of one record: suggestions, then edit cards, then a capture request
 * @param state the record with its run and conversation
 * @param tasks pending inspection tasks of the collector
 * @param unnamed localized title for records without a saved name
 * @returns the record's card, or nothing when it waits on nobody
 */
function recordInboxItem(
  { summary, run, runCompletedAt, entries }: TodayRecordState,
  tasks: readonly InspectionTask[],
  unnamed: string,
): TodayInboxItem | null {
  const base: InboxRecord = {
    recordId: summary.id,
    name: recordTitle(summary.name, unnamed),
    coverThumbnail: summary.coverThumbnail,
  };
  const suggestionCount = run ? pendingProposals(run).length : 0;
  if (run && suggestionCount > 0) {
    return {
      ...base,
      kind: 'analysis',
      runId: run.runId,
      suggestionCount,
      totalCount: run.result.output?.proposedChanges.length ?? 0,
      citationCount: run.citations.length,
      completedAt: runCompletedAt,
    };
  }
  const changes = pendingEditChanges(entries);
  if (changes.length > 0) {
    return {
      ...base,
      kind: 'editCard',
      changeCount: changes.length,
      fields: [...new Set(changes.map((change) => change.field))],
    };
  }
  const request = tasks.find(
    (task) =>
      task.kind === 'analysisAction' &&
      task.recordId === summary.id &&
      task.state.status === 'pending' &&
      task.action.kind === 'capturePhoto',
  );

  return request?.kind === 'analysisAction'
    ? { ...base, kind: 'action', runId: request.runId, action: request.action }
    : null;
}
