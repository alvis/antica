import { z } from 'zod';

import { jobStateSchema } from './job.js';
import {
  citedTextSchema,
  explicitFiltersSchema,
  hypothesisHintsSchema,
} from './knowledge-core.js';
import { regionSchema, signedReadSchema } from './media.js';
import {
  entityIdSchema,
  instantSchema,
  revisionSchema,
  cursorPageSchema,
  MAX_PAGE_SIZE,
} from './shared.js';
import { sourceCitationSchema, sourceLocatorSchema } from './source.js';

export const imageMatchRefSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('reference'),
    sourceVersionId: entityIdSchema,
    referenceImageId: entityIdSchema,
  }),
  z.strictObject({
    kind: z.literal('collection'),
    recordId: entityIdSchema,
    originalAssetId: entityIdSchema,
  }),
]);
export const imageMatchSchema = z.strictObject({
  ref: imageMatchRefSchema,
  rank: z.int().positive(),
  matchingRegions: z.array(
    z.strictObject({
      canonicalViewId: entityIdSchema,
      region: regionSchema.nullable(),
      derivativeId: entityIdSchema.nullable(),
    }),
  ),
  thumbnail: signedReadSchema.nullable(),
  sourceLocator: sourceLocatorSchema.nullable(),
  sourceTitle: z.string().nullable(),
  contributorNames: z.array(z.string()),
  warningsZhHant: z.array(z.string()),
});
export type ImageMatch = z.infer<typeof imageMatchSchema>;
export const imageSearchRequestSchema = z.strictObject({
  mode: z.literal('search'),
  queryAnchorId: entityIdSchema,
  includeWholeImage: z.boolean(),
  scope: z.enum(['reference_library', 'my_collection']),
  filters: explicitFiltersSchema,
  hypothesisHints: hypothesisHintsSchema.optional(),
  cursor: z.string().optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type ImageSearchRequest = z.infer<typeof imageSearchRequestSchema>;
export const imageCompareRequestSchema = z.strictObject({
  mode: z.literal('compare'),
  queryAnchorId: entityIdSchema,
  selected: imageMatchRefSchema,
  selectedRegion: regionSchema.nullable(),
  selectedCanonicalViewId: entityIdSchema.nullable(),
});
export type ImageCompareRequest = z.infer<typeof imageCompareRequestSchema>;
export const imageQuerySchema = z.discriminatedUnion('mode', [
  imageSearchRequestSchema,
  imageCompareRequestSchema,
]);
export const imageSearchResultSchema = cursorPageSchema(
  imageMatchSchema,
).safeExtend({
  queryAnchorId: entityIdSchema,
  indexVersion: z.string(),
  availableScope: z.enum(['complete', 'partial']),
  warningsZhHant: z.array(z.string()),
});
export type ImageSearchResult = z.infer<typeof imageSearchResultSchema>;
export const imageComparisonSchema = z.strictObject({
  comparisonId: entityIdSchema,
  queryAnchorId: entityIdSchema,
  selected: imageMatchRefSchema,
  selectedRegion: regionSchema.nullable(),
  selectedCanonicalViewId: entityIdSchema.nullable(),
  similaritiesZhHant: z.array(z.string()),
  differencesZhHant: z.array(z.string()),
  limitsZhHant: z.array(z.string()),
  citations: z.array(sourceCitationSchema),
});
export type ImageComparison = z.infer<typeof imageComparisonSchema>;

export const researchRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  instructionZhHant: z.string().trim().min(1),
  scope: z.enum(['curated_only', 'curated_and_public_web']),
  recordId: entityIdSchema.nullable(),
  entryId: entityIdSchema.nullable(),
  sourceIds: z.array(entityIdSchema),
  preferNamedAuthors: z.boolean(),
});
export type ResearchRequest = z.infer<typeof researchRequestSchema>;
export const researchAcceptedSchema = z.strictObject({
  researchId: entityIdSchema,
  jobId: entityIdSchema,
});
export type ResearchAccepted = z.infer<typeof researchAcceptedSchema>;
export const researchDraftSchema = z.strictObject({
  revision: revisionSchema,
  titleZhHant: z.string(),
  paragraphs: z.array(citedTextSchema),
  citations: z.array(sourceCitationSchema),
  unresolvedQuestionsZhHant: z.array(z.string()),
});
export type ResearchDraft = z.infer<typeof researchDraftSchema>;
export const noteSchema = z.strictObject({
  id: entityIdSchema,
  researchId: entityIdSchema,
  titleZhHant: z.string(),
  paragraphs: z.array(citedTextSchema),
  citations: z.array(sourceCitationSchema),
  recordId: entityIdSchema.nullable(),
  entryId: entityIdSchema.nullable(),
  savedBy: z.literal('collector'),
  savedAt: instantSchema,
});
export type Note = z.infer<typeof noteSchema>;
export const researchDetailSchema = z.strictObject({
  researchId: entityIdSchema,
  jobId: entityIdSchema,
  state: jobStateSchema,
  request: researchRequestSchema,
  sourceIds: z.array(entityIdSchema),
  draft: researchDraftSchema.nullable(),
  notes: z.array(noteSchema),
  warningsZhHant: z.array(z.string()),
});
export type ResearchDetail = z.infer<typeof researchDetailSchema>;
export const noteInputSchema = z.strictObject({
  requestKey: entityIdSchema,
  researchId: entityIdSchema,
  expectedDraftRevision: revisionSchema,
  titleZhHant: z.string(),
  paragraphs: z.array(citedTextSchema),
  citations: z.array(sourceCitationSchema),
  recordId: entityIdSchema.nullable(),
  entryId: entityIdSchema.nullable(),
});
export type NoteInput = z.infer<typeof noteInputSchema>;
export const referenceTargetSchema = z.strictObject({
  recordId: entityIdSchema,
  checkId: entityIdSchema.nullable(),
  observationId: entityIdSchema.nullable(),
  evidenceAnchorId: entityIdSchema.nullable(),
});
export const referenceSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('source'),
    locator: sourceLocatorSchema,
    referenceImageId: entityIdSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('collection'),
    recordId: entityIdSchema,
    originalAssetId: entityIdSchema,
    evidenceAnchorId: entityIdSchema.nullable(),
  }),
]);
export const referenceInputSchema = z.strictObject({
  requestKey: entityIdSchema,
  expectedRecordRevision: revisionSchema,
  target: referenceTargetSchema,
  reference: referenceSubjectSchema,
  comparisonId: entityIdSchema.nullable(),
  noteZhHant: z.string(),
});
export type ReferenceInput = z.infer<typeof referenceInputSchema>;
export const referenceLinkSchema = z.strictObject({
  id: entityIdSchema,
  target: referenceTargetSchema,
  reference: referenceSubjectSchema,
  comparisonId: entityIdSchema.nullable(),
  noteZhHant: z.string(),
  createdAt: instantSchema,
  versions: z.strictObject({
    recordRevision: revisionSchema,
    analysisInputVersion: revisionSchema,
    evidenceVersion: revisionSchema,
  }),
});
export type ReferenceLink = z.infer<typeof referenceLinkSchema>;
export const referencePageSchema = cursorPageSchema(referenceLinkSchema);
