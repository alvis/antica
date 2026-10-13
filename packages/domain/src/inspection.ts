import type { EvidenceAnchor } from './evidence/anchor.js';
import type { InspectionMethodVersion } from './knowledge.js';
import type { Observation, ObservationInput } from './observation.js';
import type { EntityId, RecordVersions, VersionedEntity } from './shared.js';

export type CheckResult =
  | { readonly kind: 'unrecorded' }
  | { readonly kind: 'present' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'undetermined'; readonly reason: string }
  | { readonly kind: 'not_applicable'; readonly reason: string };
export interface RecordCheck extends VersionedEntity {
  readonly recordId: EntityId;
  readonly componentIds: readonly EntityId[];
  readonly methodId: EntityId;
  readonly methodVersionId: EntityId;
  readonly suggestedByRunId: EntityId | null;
  readonly progress: 'not_started' | 'in_progress' | 'recorded';
  readonly result: CheckResult;
  readonly observationIds: readonly EntityId[];
  readonly evidenceAnchorIds: readonly EntityId[];
  readonly pendingActionIds: readonly EntityId[];
}
export interface CheckDetail {
  readonly check: RecordCheck;
  readonly method: InspectionMethodVersion;
  readonly observations: readonly Observation[];
  readonly evidence: readonly EvidenceAnchor[];
  readonly versions: RecordVersions;
  readonly methodUpdateAvailable: boolean;
}
export interface CheckCreate {
  readonly expectedRecordRevision: number;
  readonly methodId: EntityId;
  readonly methodVersionId: EntityId;
  readonly componentIds?: readonly EntityId[];
  readonly suggestedByRunId?: EntityId;
}
export interface CheckPatch {
  readonly requestKey: EntityId;
  readonly expectedRevision: number;
  readonly expectedRecordRevision: number;
  readonly progress?: RecordCheck['progress'];
  readonly result?: CheckResult;
  readonly addObservationIds?: readonly EntityId[];
  readonly addEvidenceAnchorIds?: readonly EntityId[];
  readonly newObservation?: ObservationInput;
}

/**
 * Produces a stable, duplicate-free component scope for check identity.
 * @param componentIds Component IDs selected for the check.
 * @returns Sorted unique component IDs.
 */
export function normalizeComponentScope(
  componentIds: readonly EntityId[],
): readonly EntityId[] {
  return [...new Set(componentIds)].sort();
}

/**
 * Determines whether a check result has been recorded.
 * @param result Current check result.
 * @returns Whether the result is more specific than unrecorded.
 */
export function isResolvedCheckResult(result: CheckResult): boolean {
  return result.kind !== 'unrecorded';
}
