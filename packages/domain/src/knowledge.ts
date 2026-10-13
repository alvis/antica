import type { EntityId, Instant, Revision, VersionedEntity } from './shared.js';
import type { SourceCitation, ReferenceImage } from './source.js';

export type KnowledgeKind =
  | 'material'
  | 'manufacture'
  | 'motif'
  | 'mark'
  | 'surface'
  | 'condition'
  | 'damage'
  | 'repair'
  | 'restoration'
  | 'inspection'
  | 'period'
  | 'object_type'
  | 'other';
export interface CitedText {
  readonly textZhHant: string;
  readonly citationIds: readonly EntityId[];
  readonly support: 'cited' | 'needs_source';
}
export interface ApplicabilityContext {
  readonly scope: 'general' | 'specific';
  readonly objectTypeIds: readonly EntityId[];
  readonly materialIds: readonly EntityId[];
  readonly periodIds: readonly EntityId[];
  readonly regionIds: readonly EntityId[];
  readonly limits: CitedText;
}
export interface KnowledgeContent {
  readonly titleZhHant: string;
  readonly aliases: readonly string[];
  readonly kinds: readonly KnowledgeKind[];
  readonly otherKindLabel: string | null;
  readonly summary: CitedText;
  readonly history: readonly CitedText[];
  readonly features: readonly CitedText[];
  readonly applicability: readonly ApplicabilityContext[];
  readonly exampleReferenceImageIds: readonly EntityId[];
  readonly relatedEntryIds: readonly EntityId[];
  readonly citations: readonly SourceCitation[];
}
export interface KnowledgeEntry extends VersionedEntity {
  readonly displayCode: string;
  readonly status: 'draft' | 'saved';
  readonly content: KnowledgeContent;
  readonly methodIds: readonly EntityId[];
  readonly savedBy: 'collector' | null;
}
export interface InspectionMethod {
  readonly id: EntityId;
  readonly owningEntryId: EntityId;
  readonly currentVersionId: EntityId;
}
export interface MethodDefinition {
  readonly titleZhHant: string;
  readonly history: readonly CitedText[];
  readonly featureEntryIds: readonly EntityId[];
  readonly applicability: readonly ApplicabilityContext[];
  readonly observationModes: ReadonlyArray<
    | 'phone_photo'
    | 'video'
    | 'in_person_visual'
    | 'touch'
    | 'measurement'
    | 'document_review'
    | 'specialist_or_instrument'
  >;
  readonly steps: ReadonlyArray<{
    readonly order: number;
    readonly actionZhHant: string;
    readonly evidenceToCaptureZhHant: string;
  }>;
  readonly interpretationLimits: readonly CitedText[];
  readonly exampleReferenceImageIds: readonly EntityId[];
  readonly citations: readonly SourceCitation[];
}
export interface InspectionMethodVersion {
  readonly id: EntityId;
  readonly methodId: EntityId;
  readonly revision: Revision;
  readonly definition: MethodDefinition;
  readonly createdAt: Instant;
}
export interface KnowledgeDetail {
  readonly entry: KnowledgeEntry;
  readonly methods: readonly InspectionMethod[];
  readonly methodVersions: readonly InspectionMethodVersion[];
  readonly referenceImages: readonly ReferenceImage[];
  readonly citations: readonly SourceCitation[];
}
export interface KnowledgeSummary {
  readonly id: EntityId;
  readonly displayCode: string;
  readonly revision: Revision;
  readonly titleZhHant: string;
  readonly kinds: readonly KnowledgeKind[];
  readonly status: KnowledgeEntry['status'];
  readonly summaryZhHant: string;
  readonly citationCount: number;
}
