import type { EntityId, Instant, RecordVersions } from './shared.js';

/** immutable provenance retained before a transcription provider is called */
export interface TranscriptionSnapshot {
  readonly recordId: EntityId;
  readonly recordRevision: number;
  readonly audioAssetId: EntityId;
  readonly audioSha256: string;
  readonly createdAt: Instant;
}

/** collector confirmation never rewrites the original model transcription */
export interface Transcript {
  readonly id: EntityId;
  readonly jobId: EntityId;
  readonly snapshot: TranscriptionSnapshot;
  readonly revision: number;
  readonly status: 'pending' | 'ready' | 'confirmed';
  readonly confirmedObservationId: EntityId | null;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** references the exact source revisions used to draft record changes */
export interface EditDraftSnapshot {
  readonly recordId: EntityId;
  readonly versions: RecordVersions;
  readonly transcriptionVersions: ReadonlyArray<{
    readonly id: EntityId;
    readonly revision: number;
  }>;
  readonly observationIds: readonly EntityId[];
  readonly createdAt: Instant;
}

/** records explicit proposal adoption separately from generated suggestions */
export interface EditDraft {
  readonly id: EntityId;
  readonly jobId: EntityId;
  readonly snapshot: EditDraftSnapshot;
  readonly revision: number;
  readonly status: 'pending' | 'ready' | 'partially_applied' | 'applied';
  readonly appliedProposalIds: readonly EntityId[];
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}
