import type { RecordMessageEntry } from '@antica/contracts';

/** the record's latest analysis as the conversation shows it */
export interface ThreadAnalysis {
  readonly runId: string;
  /** a queued or running analysis shows its progress; a finished one links to its suggestions */
  readonly phase: 'running' | 'finished' | 'failed';
  /** when the analysis started, or finished once it has; places it among the messages */
  readonly at?: string;
}

/** one row of the conversation, oldest first before the list inverts it */
export type ThreadRow =
  | { readonly kind: 'time'; readonly id: string; readonly at: string }
  | {
      readonly kind: 'message';
      readonly id: string;
      readonly entry: RecordMessageEntry;
    }
  | {
      readonly kind: 'analysis';
      readonly id: string;
      readonly analysis: ThreadAnalysis;
    };

/** a pause after which the thread shows the time again (v5 `.when`) */
const pauseMs = 30 * 60 * 1000;

/**
 * lays out the conversation: the messages and the latest analysis in time order, with a time chip
 * wherever the conversation resumes after a pause or on another day
 * @param entries the record's messages, oldest first
 * @param analysis the latest analysis, if any; a running one always comes last
 * @returns the rows, oldest first
 */
export function threadRows(
  entries: readonly RecordMessageEntry[],
  analysis: ThreadAnalysis | undefined,
): ThreadRow[] {
  type Timed = {
    readonly row: Exclude<ThreadRow, { kind: 'time' }>;
    readonly at?: string;
  };
  const items: Timed[] = entries.map((entry) => ({
    row: { kind: 'message', id: entry.id, entry },
    at: entry.createdAt,
  }));
  if (analysis) {
    const after =
      analysis.phase === 'running' || analysis.at === undefined
        ? -1
        : items.findIndex(
            (item) =>
              item.at !== undefined &&
              Date.parse(item.at) > Date.parse(analysis.at ?? ''),
          );
    items.splice(after < 0 ? items.length : after, 0, {
      row: { kind: 'analysis', id: `analysis-${analysis.runId}`, analysis },
      at: analysis.at,
    });
  }

  const rows: ThreadRow[] = [];
  let previous: number | undefined;
  for (const { row, at } of items) {
    const time = at === undefined ? undefined : Date.parse(at);
    if (
      at !== undefined &&
      time !== undefined &&
      (previous === undefined ||
        time - previous > pauseMs ||
        new Date(time).toDateString() !== new Date(previous).toDateString())
    ) {
      rows.push({ kind: 'time', id: `time-${row.id}`, at });
    }
    if (time !== undefined) {
      previous = time;
    }
    rows.push(row);
  }

  return rows;
}
