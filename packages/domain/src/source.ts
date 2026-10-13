import type { CanonicalView, Region } from './evidence/anchor.js';
import type { EntityId, Instant, VersionedEntity } from './shared.js';

export interface SourceContributor {
  readonly nameAsPrinted: string;
  readonly role: 'author' | 'editor' | 'reviewer' | 'institution';
  readonly attribution: 'as_printed' | 'collector_entered' | 'unverified';
}
export interface SourceMetadata {
  readonly title: string;
  readonly contributors: readonly SourceContributor[];
  readonly authorStatus: 'named' | 'unknown';
  readonly editionStatement: string | null;
  readonly publisher: string | null;
  readonly publicationDateAsPrinted: string | null;
  readonly isbn: string | null;
  readonly languages: readonly string[];
  readonly canonicalUrl: string | null;
  readonly access: 'stored_copy' | 'link_only';
  readonly rightsStatement: string | null;
  readonly attributionText: string | null;
}
export interface Source extends VersionedEntity {
  readonly kind: 'book_pdf' | 'book_pages' | 'web';
  readonly metadata: SourceMetadata;
  readonly currentVersionId: EntityId;
}
export type SourceAvailability =
  'registered' | 'processing' | 'ready' | 'partial' | 'failed';
export const MAX_ROTATION_QUARTER_TURNS = 3;
export interface SourceVersion {
  readonly id: EntityId;
  readonly sourceId: EntityId;
  readonly originalAssetIds: readonly EntityId[];
  readonly sourceHash: string;
  readonly metadataSnapshot: SourceMetadata;
  readonly capturedAt: Instant;
  readonly retrievedAt: Instant | null;
  readonly status: SourceAvailability;
  readonly textIndexStatus: SourceAvailability;
  readonly imageIndexStatus: SourceAvailability;
  readonly activeParseRunId: EntityId | null;
}
export interface SourcePage {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  readonly pageIndex: number;
  readonly printedPageLabel: string | null;
  readonly originalAssetId: EntityId;
  readonly pdfPageIndex: number | null;
  readonly view: CanonicalView;
  readonly presentation: {
    readonly rotationQuarterTurns:
      0 | 1 | 2 | typeof MAX_ROTATION_QUARTER_TURNS;
    readonly crop: Extract<Region, { readonly kind: 'rect' }> | null;
  } | null;
  readonly rawText: string;
  readonly searchText: string;
  readonly quality: 'usable' | 'needs_review' | 'unusable';
  readonly regionIds: readonly EntityId[];
}
export type SourceLocator = {
  readonly sourceId: EntityId;
  readonly sourceVersionId: EntityId;
} & (
  | {
      readonly kind: 'page';
      readonly pageId: EntityId;
      readonly pageIndex: number;
      readonly printedPageLabel: string | null;
      readonly canonicalViewId: EntityId;
      readonly regionId: EntityId | null;
      readonly region: Region | null;
      readonly textRange: {
        readonly blockId: EntityId;
        readonly start: number;
        readonly end: number;
      } | null;
    }
  | {
      readonly kind: 'web';
      readonly url: string;
      readonly retrievedAt: Instant;
      readonly snapshotAssetId: EntityId | null;
      readonly blockId: EntityId | null;
      readonly excerptAsRetrieved: string | null;
    }
);
export interface SourceCitation {
  readonly id: EntityId;
  readonly locator: SourceLocator;
  readonly relation: 'supports' | 'background' | 'comparison';
  readonly availability: 'stored' | 'link_only' | 'unavailable';
  readonly verification: 'located' | 'needs_review';
}
export interface SourceRegion {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  readonly pageId: EntityId;
  readonly kind: 'text' | 'figure' | 'caption' | 'table';
  readonly region: Region;
  readonly rawText: string | null;
  readonly relatedRegionIds: readonly EntityId[];
}
export interface ReferenceImage {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  readonly locator: SourceLocator;
  readonly figureRegionId: EntityId | null;
  readonly storedDerivativeId: EntityId | null;
  readonly externalImageUrl: string | null;
  readonly originalCaption: {
    readonly textAsPrinted: string;
    readonly locator: SourceLocator;
  } | null;
  readonly generatedDescriptionZhHant: string | null;
  readonly descriptionJobId: EntityId | null;
  readonly captionAssociation: 'verified' | 'needs_review' | 'none';
}
