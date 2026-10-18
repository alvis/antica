import { z } from 'zod';

import {
  canonicalViewSchema,
  regionSchema,
  rectRegionSchema,
  rotationQuarterTurnsSchema,
  signedReadSchema,
} from './media.js';
import {
  entityIdSchema,
  instantSchema,
  revisionSchema,
  cursorPageSchema,
} from './shared.js';

export * from './source-structured.js';

export const sourceContributorSchema = z.strictObject({
  nameAsPrinted: z.string(),
  role: z.enum(['author', 'editor', 'reviewer', 'institution']),
  attribution: z.enum(['as_printed', 'collector_entered', 'unverified']),
});
export const sourceMetadataSchema = z.strictObject({
  title: z.string(),
  contributors: z.array(sourceContributorSchema),
  authorStatus: z.enum(['named', 'unknown']),
  editionStatement: z.string().nullable(),
  publisher: z.string().nullable(),
  publicationDateAsPrinted: z.string().nullable(),
  isbn: z.string().nullable(),
  languages: z.array(z.string()),
  canonicalUrl: z.url().nullable(),
  access: z.enum(['stored_copy', 'link_only']),
  rightsStatement: z.string().nullable(),
  attributionText: z.string().nullable(),
});
export const sourceSchema = z.strictObject({
  id: entityIdSchema,
  revision: revisionSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
  kind: z.enum(['book_pdf', 'book_pages', 'web']),
  metadata: sourceMetadataSchema,
  currentVersionId: entityIdSchema,
});
export const sourceAvailabilitySchema = z.enum([
  'registered',
  'processing',
  'ready',
  'partial',
  'failed',
]);
export const sourceVersionSchema = z.strictObject({
  id: entityIdSchema,
  sourceId: entityIdSchema,
  originalAssetIds: z.array(entityIdSchema),
  sourceHash: z.string(),
  metadataSnapshot: sourceMetadataSchema,
  capturedAt: instantSchema,
  retrievedAt: instantSchema.nullable(),
  status: sourceAvailabilitySchema,
  textIndexStatus: sourceAvailabilitySchema,
  imageIndexStatus: sourceAvailabilitySchema,
  activeParseRunId: entityIdSchema.nullable(),
});
export const sourcePageSchema = z.strictObject({
  id: entityIdSchema,
  sourceVersionId: entityIdSchema,
  pageIndex: z.int().nonnegative(),
  printedPageLabel: z.string().nullable(),
  originalAssetId: entityIdSchema,
  pdfPageIndex: z.int().nonnegative().nullable(),
  view: canonicalViewSchema,
  presentation: z
    .strictObject({
      rotationQuarterTurns: rotationQuarterTurnsSchema,
      crop: rectRegionSchema.nullable(),
    })
    .nullable(),
  rawText: z.string(),
  searchText: z.string(),
  quality: z.enum(['usable', 'needs_review', 'unusable']),
  regionIds: z.array(entityIdSchema),
});
const locatorBase = {
  sourceId: entityIdSchema,
  sourceVersionId: entityIdSchema,
};
export const sourceLocatorSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...locatorBase,
    kind: z.literal('page'),
    pageId: entityIdSchema,
    pageIndex: z.int().nonnegative(),
    printedPageLabel: z.string().nullable(),
    canonicalViewId: entityIdSchema,
    regionId: entityIdSchema.nullable(),
    region: regionSchema.nullable(),
    textRange: z
      .strictObject({
        blockId: entityIdSchema,
        start: z.int().nonnegative(),
        end: z.int().nonnegative(),
      })
      .refine((range) => range.end > range.start)
      .nullable(),
  }),
  z.strictObject({
    ...locatorBase,
    kind: z.literal('web'),
    url: z.url(),
    retrievedAt: instantSchema,
    snapshotAssetId: entityIdSchema.nullable(),
    blockId: entityIdSchema.nullable(),
    excerptAsRetrieved: z.string().nullable(),
  }),
]);
export const sourceCitationSchema = z.strictObject({
  id: entityIdSchema,
  locator: sourceLocatorSchema,
  relation: z.enum(['supports', 'background', 'comparison']),
  availability: z.enum(['stored', 'link_only', 'unavailable']),
  verification: z.enum(['located', 'needs_review']),
});
export const sourceRegionSchema = z.strictObject({
  id: entityIdSchema,
  sourceVersionId: entityIdSchema,
  pageId: entityIdSchema,
  kind: z.enum(['text', 'figure', 'caption', 'table']),
  region: regionSchema,
  rawText: z.string().nullable(),
  relatedRegionIds: z.array(entityIdSchema),
});
export const referenceImageSchema = z.strictObject({
  id: entityIdSchema,
  sourceVersionId: entityIdSchema,
  locator: sourceLocatorSchema,
  figureRegionId: entityIdSchema.nullable(),
  storedDerivativeId: entityIdSchema.nullable(),
  externalImageUrl: z.url().nullable(),
  originalCaption: z
    .strictObject({ textAsPrinted: z.string(), locator: sourceLocatorSchema })
    .nullable(),
  generatedDescriptionZhHant: z.string().nullable(),
  descriptionJobId: entityIdSchema.nullable(),
  captionAssociation: z.enum(['verified', 'needs_review', 'none']),
});
export const sourceDetailSchema = z.strictObject({
  source: sourceSchema,
  version: sourceVersionSchema,
  pages: cursorPageSchema(sourcePageSchema),
  regions: z.array(sourceRegionSchema),
  referenceImages: z.array(referenceImageSchema),
  reads: z.array(signedReadSchema),
  processingJobId: entityIdSchema.nullable(),
  knowledgeDraftIds: z.array(entityIdSchema),
});
export type SourceDetail = z.infer<typeof sourceDetailSchema>;
export const sourceRegistrationSchema = z
  .strictObject({
    intakeKey: entityIdSchema,
    kind: z.enum(['book_pdf', 'book_pages']),
    metadata: sourceMetadataSchema,
    assets: z.array(
      z.strictObject({
        assetId: entityIdSchema,
        order: z.int().nonnegative(),
        printedPageLabel: z.string().nullable(),
        /** crops normalized EXIF-canonical coordinates before clockwise quarter-turns while preserving original bytes */
        presentation: z
          .strictObject({
            rotationQuarterTurns: rotationQuarterTurnsSchema,
            crop: rectRegionSchema.nullable(),
          })
          .optional(),
      }),
    ),
    existingSourceId: entityIdSchema.nullable(),
    expectedRevision: revisionSchema.nullable(),
  })
  .refine(
    (value) =>
      (value.existingSourceId === null) === (value.expectedRevision === null),
  )
  .refine(
    (value) =>
      value.kind === 'book_pages' ||
      value.assets.every((asset) => asset.presentation === undefined),
  );
export const sourceCommandSchema = z.discriminatedUnion('mode', [
  z.strictObject({
    requestKey: entityIdSchema,
    mode: z.literal('register'),
    registration: sourceRegistrationSchema,
  }),
  z.strictObject({
    requestKey: entityIdSchema,
    mode: z.literal('reprocess'),
    sourceVersionId: entityIdSchema,
    pageIds: z.array(entityIdSchema),
  }),
]);
export type SourceCommand = z.infer<typeof sourceCommandSchema>;
export const sourceAcceptedSchema = z.strictObject({
  sourceId: entityIdSchema,
  sourceVersionId: entityIdSchema,
  jobId: entityIdSchema,
});
export type SourceAccepted = z.infer<typeof sourceAcceptedSchema>;
