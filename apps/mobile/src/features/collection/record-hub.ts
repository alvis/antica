import { isProposalCurrent } from '@antica/contracts';

import type {
  AnalysisRunDetail,
  InspectionTask,
  MediaDetail,
  NextAction,
  ProposedChange,
  RecordDetail,
  RecordMessageEntry,
} from '@antica/contracts';

import type { RecordAnalysisState } from './record-analysis-state';

/**
 * the one action the record hub puts first, chosen from what waits on the collector: suggestions
 * to review, then edit-card rows to confirm, then a photo the analysis asked for, then analysis
 */
export type RecordPrimary =
  | {
      readonly kind: 'review';
      readonly runId: string;
      /** suggestions neither accepted nor skipped */
      readonly count: number;
      /** whether the collector has decided none of them yet */
      readonly untouched: boolean;
    }
  | { readonly kind: 'confirmEdits'; readonly count: number }
  | { readonly kind: 'capture'; readonly action: NextAction }
  | {
      readonly kind: 'analyse';
      readonly state: Extract<
        RecordAnalysisState,
        'unanalysed' | 'failed' | 'outdated'
      >;
    }
  | { readonly kind: 'running' }
  | { readonly kind: 'unknown' }
  | { readonly kind: 'done'; readonly runId: string };

/** what the hub knows when it picks its first action */
export interface RecordPrimaryInput {
  readonly analysisState: RecordAnalysisState;
  readonly run?: AnalysisRunDetail;
  /** edit-card changes still waiting in the record's conversation */
  readonly editChanges: readonly ProposedChange[];
  /** the record's pending inspection tasks */
  readonly tasks: readonly InspectionTask[];
}

/** a field tile's badge: the analysis suggests a value, or an edit card waits on it */
export type FieldBadge = 'suggestion' | 'edit';

/**
 * picks the hub's first action; nothing is decided for the collector, each choice opens the
 * screen where they decide it
 * @param input analysis state, latest run, waiting edit changes and tasks
 * @param input.analysisState how the record stands against analysis
 * @param input.run the latest run, once read
 * @param input.editChanges edit-card rows still waiting
 * @param input.tasks the record's pending tasks
 * @returns the action the hub's primary button takes
 */
export function recordPrimary({
  analysisState,
  run,
  editChanges,
  tasks,
}: RecordPrimaryInput): RecordPrimary {
  if (analysisState === 'running') {
    return { kind: 'running' };
  }
  if (analysisState === 'outdated') {
    // suggestions from before the new evidence stay reachable under 建議; analysing comes first
    return { kind: 'analyse', state: analysisState };
  }
  const pending = run ? pendingProposals(run) : [];
  if (run && pending.length > 0) {
    return {
      kind: 'review',
      runId: run.runId,
      count: pending.length,
      untouched:
        pending.length === (run.result.output?.proposedChanges ?? []).length,
    };
  }
  if (editChanges.length > 0) {
    return { kind: 'confirmEdits', count: editChanges.length };
  }
  const capture = tasks.find(
    (task) =>
      task.kind === 'analysisAction' &&
      task.state.status === 'pending' &&
      task.action.kind === 'capturePhoto',
  );
  if (capture?.kind === 'analysisAction') {
    return { kind: 'capture', action: capture.action };
  }
  if (analysisState === 'unanalysed' || analysisState === 'failed') {
    return { kind: 'analyse', state: analysisState };
  }
  if (analysisState === 'unknown' || !run) {
    return { kind: 'unknown' };
  }

  return { kind: 'done', runId: run.runId };
}

/**
 * lists a run's suggestions that are neither accepted nor skipped, stale ones included
 * @param run analysis run with its proposals and their states
 * @returns the waiting proposals
 */
export function pendingProposals(run: AnalysisRunDetail): ProposedChange[] {
  const decided = new Set(
    run.result.proposalStates
      .filter((state) => state.status !== 'pending')
      .map((state) => state.proposalId),
  );

  return (run.result.output?.proposedChanges ?? []).filter(
    (proposal) => !decided.has(proposal.id),
  );
}

/**
 * lists the edit-card changes of a conversation that are neither applied nor skipped
 * @param entries messages with the state of their edit drafts
 * @returns the undecided proposed changes, oldest message first
 */
export function pendingEditChanges(
  entries: readonly RecordMessageEntry[],
): ProposedChange[] {
  // a message and the assistant's reply share one edit draft, so each draft counts once
  const drafts = new Map(
    entries.map((entry) => [entry.editDraftId, entry.draft] as const),
  );

  return [...drafts.values()].flatMap((draft) => {
    if (draft.status !== 'ready' && draft.status !== 'partially_applied') {
      return [];
    }
    const decided = new Set([
      ...draft.appliedProposalIds,
      ...draft.skippedProposalIds,
    ]);

    return draft.proposedChanges.filter((change) => !decided.has(change.id));
  });
}

/**
 * marks the fields something waits on: a pending analysis suggestion, else an edit-card row;
 * an outdated proposal marks nothing, as it can no longer be applied
 * @param record the record as it is now
 * @param suggestions the run's waiting proposals
 * @param editChanges the conversation's waiting edit changes
 * @returns the badge of each field that has one
 */
export function fieldBadges(
  record: RecordDetail,
  suggestions: readonly ProposedChange[],
  editChanges: readonly ProposedChange[],
): ReadonlyMap<ProposedChange['field'], FieldBadge> {
  const badges = new Map<ProposedChange['field'], FieldBadge>();
  for (const change of editChanges) {
    if (isProposalCurrent(record, change)) {
      badges.set(change.field, 'edit');
    }
  }
  for (const proposal of suggestions) {
    if (isProposalCurrent(record, proposal)) {
      badges.set(proposal.field, 'suggestion');
    }
  }

  return badges;
}

/**
 * orders the record's object photos for the carousel; the record keeps no order of its own,
 * so photos follow the order they were added, which the cover also follows
 * @param media the record's loaded media
 * @returns object photos and videos, oldest first; receipts and voice notes are left out
 */
export function carouselMedia(media: readonly MediaDetail[]): MediaDetail[] {
  return media
    .filter((detail) => detail.asset.purpose === 'object')
    .sort(
      (left, right) =>
        Date.parse(left.asset.createdAt) - Date.parse(right.asset.createdAt),
    );
}

/**
 * names a photo's angle from its file name, such as 正面 for 正面.jpg; the record stores no
 * angle, and camera file names such as IMG_0042 name none
 * @param fileName the photo's original file name
 * @returns the angle, or nothing when the name is a camera's sequence name
 */
export function angleLabel(fileName: string): string | undefined {
  const stem = fileName.replace(/\.[^.]+$/u, '').trim();

  return stem && !/^(?:img|dsc|pxl|photo|image)?[\s_-]*\d+$/iu.test(stem)
    ? stem
    : undefined;
}

/** the dimension a tile summarises first: the one collectors measure a piece of that form by */
const dimensionOrder = ['diameter', 'height', 'width', 'depth'] as const;

/**
 * picks the record's headline dimension for the 尺寸 tile and the title's meta line
 * @param dimensions the record's measurements
 * @returns the first measured length with its field, or nothing when none is measured
 */
export function headlineDimension(dimensions: RecordDetail['dimensions']):
  | {
      readonly field: (typeof dimensionOrder)[number];
      readonly measurement: NonNullable<
        RecordDetail['dimensions'][(typeof dimensionOrder)[number]]
      >;
    }
  | undefined {
  for (const field of dimensionOrder) {
    const measurement = dimensions[field];
    if (measurement) {
      return { field, measurement };
    }
  }

  return undefined;
}
