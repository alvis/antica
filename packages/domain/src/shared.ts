export type EntityId = string;
export type Instant = string;
export type Revision = number;

export interface VersionedEntity {
  readonly id: EntityId;
  readonly revision: Revision;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

export interface RecordVersions {
  readonly recordRevision: Revision;
  readonly analysisInputVersion: Revision;
  readonly evidenceVersion: Revision;
}
