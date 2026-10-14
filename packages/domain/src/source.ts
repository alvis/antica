import type { CanonicalView, Region } from './evidence/anchor.js';
import type { EntityId, Instant, VersionedEntity } from './shared.js';

/** contributor credit and the provenance of its attribution */
export interface SourceContributor {
  /** name retained as it appears in the source */
  readonly nameAsPrinted: string;
  readonly role: 'author' | 'editor' | 'reviewer' | 'institution';
  /** distinguishes printed credits from collector entry and unverified attribution */
  readonly attribution: 'as_printed' | 'collector_entered' | 'unverified';
}
/** bibliographic, access, and rights details retained for a source */
export interface SourceMetadata {
  readonly title: string;
  readonly contributors: readonly SourceContributor[];
  /** records whether a named author was available, independent of other credits */
  readonly authorStatus: 'named' | 'unknown';
  readonly editionStatement: string | null;
  readonly publisher: string | null;
  readonly publicationDateAsPrinted: string | null;
  readonly isbn: string | null;
  readonly languages: readonly string[];
  readonly canonicalUrl: string | null;
  /** distinguishes stored source content from an external link */
  readonly access: 'stored_copy' | 'link_only';
  readonly rightsStatement: string | null;
  readonly attributionText: string | null;
}
/** source identity and its currently selected immutable version */
export interface Source extends VersionedEntity {
  readonly kind: 'book_pdf' | 'book_pages' | 'web';
  readonly metadata: SourceMetadata;
  readonly currentVersionId: EntityId;
}
/** processing state of a source version or one of its indexes */
export type SourceAvailability =
  'registered' | 'processing' | 'ready' | 'partial' | 'failed';
/** largest supported rotation in quarter-turns */
export const MAX_ROTATION_QUARTER_TURNS = 3;
/** source capture with separately tracked text and image indexing */
export interface SourceVersion {
  readonly id: EntityId;
  readonly sourceId: EntityId;
  /** originals captured for this version */
  readonly originalAssetIds: readonly EntityId[];
  readonly sourceHash: string;
  /** metadata as it stood when this version was captured */
  readonly metadataSnapshot: SourceMetadata;
  readonly capturedAt: Instant;
  readonly retrievedAt: Instant | null;
  readonly status: SourceAvailability;
  /** text indexing progress independent of the overall version status */
  readonly textIndexStatus: SourceAvailability;
  /** image indexing progress independent of text indexing */
  readonly imageIndexStatus: SourceAvailability;
  /** parse run currently responsible for this version, when present */
  readonly activeParseRunId: EntityId | null;
}
/** canonical page text, presentation, and evidence-region references */
export interface SourcePage {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  /** canonical page index used by source locators */
  readonly pageIndex: number;
  /** label printed on the source page, when one exists */
  readonly printedPageLabel: string | null;
  readonly originalAssetId: EntityId;
  /** original PDF page index when the source is a PDF */
  readonly pdfPageIndex: number | null;
  readonly view: CanonicalView;
  readonly presentation: {
    readonly rotationQuarterTurns:
      0 | 1 | 2 | typeof MAX_ROTATION_QUARTER_TURNS;
    readonly crop: Extract<Region, { readonly kind: 'rect' }> | null;
  } | null;
  /** text retained from the parsed source */
  readonly rawText: string;
  /** text prepared for search without replacing the retained source text */
  readonly searchText: string;
  readonly quality: 'usable' | 'needs_review' | 'unusable';
  readonly regionIds: readonly EntityId[];
}
/** precise page or web location within an immutable source version */
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
      /** block-relative text offsets when the citation targets a text span */
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
/** citation identity, target, and verification state */
export interface SourceCitation {
  readonly id: EntityId;
  readonly locator: SourceLocator;
  /** role of this citation in the collector's claim */
  readonly relation: 'supports' | 'background' | 'comparison';
  readonly availability: 'stored' | 'link_only' | 'unavailable';
  readonly verification: 'located' | 'needs_review';
}
/** source-page region with optional extracted text and related regions */
export interface SourceRegion {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  readonly pageId: EntityId;
  readonly kind: 'text' | 'figure' | 'caption' | 'table';
  readonly region: Region;
  readonly rawText: string | null;
  readonly relatedRegionIds: readonly EntityId[];
}
/** image reference tied to its source location and caption provenance */
export interface ReferenceImage {
  readonly id: EntityId;
  readonly sourceVersionId: EntityId;
  readonly locator: SourceLocator;
  readonly figureRegionId: EntityId | null;
  readonly storedDerivativeId: EntityId | null;
  readonly externalImageUrl: string | null;
  /** original caption and its own location in the source */
  readonly originalCaption: {
    readonly textAsPrinted: string;
    readonly locator: SourceLocator;
  } | null;
  /** generated Traditional Chinese description, separate from the original caption */
  readonly generatedDescriptionZhHant: string | null;
  readonly descriptionJobId: EntityId | null;
  readonly captionAssociation: 'verified' | 'needs_review' | 'none';
}
