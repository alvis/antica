import type { EntityId, Instant } from './shared.js';

export interface ObservationInput {
  readonly recordId: EntityId;
  readonly componentIds: readonly EntityId[];
  readonly channel: 'typed' | 'voice' | 'feature_confirmation';
  readonly text: string;
  readonly evidenceAnchorIds: readonly EntityId[];
  readonly checkIds: readonly EntityId[];
  readonly observedAt: Instant;
  readonly voice: {
    readonly audioAssetId: EntityId;
    readonly transcriptionId: EntityId;
    readonly segmentId: EntityId | null;
  } | null;
  readonly editDraftId: EntityId | null;
  readonly supersedesObservationId: EntityId | null;
}
export interface Observation extends ObservationInput {
  readonly id: EntityId;
  readonly author: 'collector';
  readonly createdAt: Instant;
  readonly supersededByObservationId: EntityId | null;
}
