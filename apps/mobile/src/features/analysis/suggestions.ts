import { isProposalCurrent } from '@antica/contracts';

import type {
  AnalysisRunDetail,
  MediaDetail,
  ProposedChange,
  RecordDetail,
} from '@antica/contracts';

/** where a suggestion stands for the collector */
export type SuggestionState =
  /** waiting, and its field still holds the value it was made against */
  | 'open'
  /** waiting, but the field changed since, so it can no longer be applied */
  | 'stale'
  | 'accepted'
  | 'skipped';

/** a photo a suggestion rests on */
export interface SuggestionPhoto {
  readonly assetId: string;
  /** the anchor the finding cites, which opens the photo at that spot */
  readonly anchorId: string;
  readonly fileName: string;
  readonly uri?: string;
}

/** one field suggestion as the 建議 segment shows it */
export interface Suggestion {
  readonly change: ProposedChange;
  readonly state: SuggestionState;
  /** the findings' observations, the suggestion's reason */
  readonly reasons: readonly string[];
  /** photos the findings cite, each once */
  readonly photos: readonly SuggestionPhoto[];
  /** sources the findings cite, each once, in finding order */
  readonly citationIds: readonly string[];
}

/**
 * reads the record's current value of a suggested field
 * @param record the record as the screen shows it
 * @param field the suggested field
 * @returns the field's value now
 */
export function currentFieldValue(
  record: RecordDetail,
  field: ProposedChange['field'],
): ProposedChange['before'] {
  return record[field] ?? null;
}

/**
 * tells whether a field still holds the value a suggestion was made against; once the collector
 * changes it, the server refuses the suggestion, so the screen does not offer it
 * @param change the suggestion
 * @param record the record as the screen shows it
 * @returns whether the suggestion still applies
 */
export function stillApplies(
  change: ProposedChange,
  record: RecordDetail,
): boolean {
  return isProposalCurrent(record, change);
}

/**
 * lists a run's suggestions with what each rests on and whether it can still be applied; nothing
 * is ticked here, ticking is the collector's
 * @param run the analysis run
 * @param record the record, once read; without it no suggestion counts as stale
 * @param media the run's photos, once read
 * @returns the suggestions in the run's order
 */
export function runSuggestions(
  run: AnalysisRunDetail,
  record: RecordDetail | undefined,
  media: readonly MediaDetail[],
): Suggestion[] {
  const output = run.result.output;
  if (!output) {
    return [];
  }
  const states = new Map(
    run.result.proposalStates.map((state) => [state.proposalId, state.status]),
  );

  return output.proposedChanges.map((change) => {
    const findings = output.findings.filter((finding) =>
      change.findingIds.includes(finding.id),
    );
    const status = states.get(change.id) ?? 'pending';
    const photos = new Map<string, SuggestionPhoto>();
    for (const anchorId of findings.flatMap((finding) => finding.evidenceIds)) {
      const detail = media.find((item) =>
        item.anchors.some((anchor) => anchor.id === anchorId),
      );
      if (detail && !photos.has(detail.asset.id)) {
        photos.set(detail.asset.id, {
          assetId: detail.asset.id,
          anchorId,
          fileName: detail.asset.originalFileName,
          uri:
            detail.asset.kind === 'photo' ? detail.reads.at(0)?.url : undefined,
        });
      }
    }

    return {
      change,
      state:
        status !== 'pending'
          ? status
          : record && !stillApplies(change, record)
            ? 'stale'
            : 'open',
      reasons: findings.map((finding) => finding.text),
      photos: [...photos.values()],
      citationIds: [
        ...new Set(findings.flatMap((finding) => finding.citationIds)),
      ],
    };
  });
}
