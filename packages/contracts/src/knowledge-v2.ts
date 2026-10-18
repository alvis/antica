import { z } from 'zod';

import {
  isBcp47Language,
  validateEnvelopeConsistency,
} from './knowledge-v2-validation.js';
import { entityIdSchema, instantSchema } from './shared.js';
import {
  observedRightsSchema,
  structuredSourceSnapshotSchema,
} from './source.js';

const maximumTextLength = 24_000;
const maximumKeyLength = 200;
const maximumLanguageLength = 35;
const maximumUrlLength = 2_048;
const maximumSmallCollectionSize = 100;
const maximumCollectionSize = 500;
const maximumLargeCollectionSize = 1_000;

const boundedTextSchema = z.string().min(1).max(maximumTextLength);
const boundedKeySchema = z.string().min(1).max(maximumKeyLength);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const knowledgeLanguageV2Schema = z
  .string()
  .min(2)
  .max(maximumLanguageLength)
  .refine(isBcp47Language);
const httpUrlSchema = z
  .string()
  .max(maximumUrlLength)
  .url()
  .refine(
    (value) => value.startsWith('http://') || value.startsWith('https://'),
  );
const reviewStateSchema = z.enum(['pending', 'reviewed', 'rejected']);
const claimSectionSchema = z.enum([
  'summary',
  'history',
  'features',
  'applicability',
  'limits',
]);
const reviewSchema = z
  .strictObject({
    state: reviewStateSchema,
    actor: boundedKeySchema.optional(),
    at: instantSchema.optional(),
  })
  .refine((review) =>
    review.state === 'pending'
      ? review.actor === undefined && review.at === undefined
      : review.actor !== undefined && review.at !== undefined,
  );
const inputReviewSchema = z.strictObject({ state: reviewStateSchema });

export const localizedTextV2Schema = z.strictObject({
  language: knowledgeLanguageV2Schema,
  text: boundedTextSchema,
});
export const citedTextV2Schema = z
  .strictObject({
    claimKey: boundedKeySchema,
    text: boundedTextSchema,
    citationIds: z.array(entityIdSchema).max(maximumSmallCollectionSize),
    supportState: z.enum(['cited', 'needs_source']),
  })
  .refine(
    (node) => node.supportState !== 'cited' || node.citationIds.length > 0,
  );
export const knowledgeTopicV2Schema = z.strictObject({
  topicId: entityIdSchema,
  applicability: z.enum(['general', 'specific']),
  uncertainty: boundedTextSchema.optional(),
});
export const knowledgeVariantV2Schema = z.strictObject({
  language: knowledgeLanguageV2Schema,
  kind: z.enum(['original', 'translation']),
  text: boundedTextSchema,
  method: z.enum(['original', 'human', 'machine']),
  translator: boundedKeySchema.optional(),
  translatedAt: instantSchema.optional(),
  sourceTextHash: sha256Schema,
  review: reviewSchema,
});
const knowledgeVariantV2InputSchema = knowledgeVariantV2Schema.extend({
  review: inputReviewSchema,
});
export const knowledgeClaimV2Schema = z.strictObject({
  claimKey: boundedKeySchema,
  section: claimSectionSchema,
  ordinal: z.int().nonnegative(),
  originalText: boundedTextSchema,
  originalLanguage: knowledgeLanguageV2Schema,
  statementType: z.enum([
    'source_attribution',
    'observation',
    'interpretation',
    'method',
    'limitation',
  ]),
  scope: z.record(
    z.string().max(maximumKeyLength),
    z.array(boundedTextSchema).max(maximumSmallCollectionSize),
  ),
  qualifiers: z.record(z.string().max(maximumKeyLength), boundedTextSchema),
  uncertainty: boundedTextSchema.optional(),
  supportState: z.enum(['cited', 'needs_source']),
  citationIds: z.array(entityIdSchema).max(maximumSmallCollectionSize),
  review: reviewSchema,
  variants: z.array(knowledgeVariantV2Schema).max(maximumSmallCollectionSize),
});
const knowledgeClaimV2InputSchema = knowledgeClaimV2Schema.extend({
  review: inputReviewSchema,
  variants: z
    .array(knowledgeVariantV2InputSchema)
    .max(maximumSmallCollectionSize),
});
export const knowledgeLocatorV2Schema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('structured'),
    id: entityIdSchema,
    sourceId: entityIdSchema,
    sourceVersionId: entityIdSchema,
    provider: boundedKeySchema,
    objectId: z.string().min(1).max(maximumLargeCollectionSize),
    fieldPath: z
      .string()
      .max(maximumUrlLength)
      .regex(/^(?:\/(?:[^~/]|~[01])*)*$/),
    valueHash: sha256Schema,
    url: httpUrlSchema,
    retrievedAt: instantSchema,
    excerpt: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal('web'),
    id: entityIdSchema,
    sourceId: entityIdSchema,
    sourceVersionId: entityIdSchema,
    url: httpUrlSchema,
    retrievedAt: instantSchema,
    section: boundedTextSchema.optional(),
    excerpt: boundedTextSchema,
  }),
  z.strictObject({
    kind: z.literal('page'),
    id: entityIdSchema,
    sourceId: entityIdSchema,
    sourceVersionId: entityIdSchema,
    pageId: entityIdSchema,
    pageIndex: z.int().nonnegative(),
    printedPageLabel: z.string().max(maximumKeyLength).nullable(),
    excerpt: boundedTextSchema,
  }),
]);
export const knowledgeSourceV2Schema = z.strictObject({
  id: entityIdSchema,
  versionId: entityIdSchema,
  title: boundedTextSchema,
  canonicalUrl: httpUrlSchema.optional(),
  languages: z
    .array(knowledgeLanguageV2Schema)
    .min(1)
    .max(maximumSmallCollectionSize),
  contributors: z.array(boundedTextSchema).max(maximumSmallCollectionSize),
  structuredSnapshot: structuredSourceSnapshotSchema.optional(),
});
export const knowledgeCitationV2Schema = z.strictObject({
  id: entityIdSchema,
  relation: z.enum(['supports', 'background', 'comparison']),
  availability: z.enum(['stored', 'link_only', 'unavailable']),
  verification: z.enum(['located', 'needs_review']),
  quote: boundedTextSchema,
  locator: knowledgeLocatorV2Schema,
  source: knowledgeSourceV2Schema,
});
export const knowledgeImageV2Schema = z.strictObject({
  id: entityIdSchema,
  sourceVersionId: entityIdSchema,
  imageUrl: httpUrlSchema,
  sourcePageUrl: httpUrlSchema,
  provider: boundedKeySchema,
  providerImageId: boundedKeySchema.optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  observedRights: observedRightsSchema.optional(),
  lastCheckedAt: instantSchema.optional(),
  status: z.enum(['unchecked', 'available', 'unavailable', 'removed']),
  locatorId: entityIdSchema.optional(),
});

const contentEnvelopeShape = {
  contentSchemaVersion: z.literal(2),
  entryType: z.enum(['concept', 'method', 'object_example']),
  origin: z.enum([
    'curated_seed',
    'open_import',
    'book',
    'research',
    'collector',
  ]),
  titles: z.array(localizedTextV2Schema).min(1).max(maximumSmallCollectionSize),
  aliases: z.array(localizedTextV2Schema).max(maximumSmallCollectionSize),
  sections: z.strictObject({
    summary: citedTextV2Schema,
    history: z.array(citedTextV2Schema).max(maximumCollectionSize),
    features: z.array(citedTextV2Schema).max(maximumCollectionSize),
    applicability: z.array(citedTextV2Schema).max(maximumCollectionSize),
    limits: z.array(citedTextV2Schema).max(maximumCollectionSize),
  }),
  topics: z.array(knowledgeTopicV2Schema).max(maximumCollectionSize),
  citations: z.array(knowledgeCitationV2Schema).max(maximumLargeCollectionSize),
  images: z.array(knowledgeImageV2Schema).max(maximumCollectionSize),
  methodIds: z.array(entityIdSchema).max(maximumSmallCollectionSize),
  methodVersionIds: z
    .array(entityIdSchema)
    .max(maximumSmallCollectionSize)
    .optional(),
  relatedEntryIds: z.array(entityIdSchema).max(maximumCollectionSize),
  referenceLinks: z
    .array(
      z.strictObject({
        id: entityIdSchema,
        targetRecordId: entityIdSchema,
        targetCheckId: entityIdSchema.optional(),
        targetObservationId: entityIdSchema.optional(),
        targetAnchorId: entityIdSchema.optional(),
      }),
    )
    .max(maximumCollectionSize)
    .optional(),
};
export const knowledgeContentEnvelopeV2Schema = z
  .strictObject({
    ...contentEnvelopeShape,
    claims: z
      .array(knowledgeClaimV2Schema)
      .min(1)
      .max(maximumLargeCollectionSize),
    editorialReview: reviewSchema,
  })
  .superRefine(validateEnvelopeConsistency);
export type KnowledgeContentEnvelopeV2 = z.infer<
  typeof knowledgeContentEnvelopeV2Schema
>;
export const knowledgeContentEnvelopeV2InputSchema = z
  .strictObject({
    ...contentEnvelopeShape,
    claims: z
      .array(knowledgeClaimV2InputSchema)
      .min(1)
      .max(maximumLargeCollectionSize),
    editorialReview: inputReviewSchema,
  })
  .superRefine(validateEnvelopeConsistency);

export const knowledgeReviewDecisionSchema = z.strictObject({
  claimKey: boundedKeySchema,
  state: z.enum(['reviewed', 'rejected']),
});
export const knowledgeTranslationDecisionSchema = z.strictObject({
  claimKey: boundedKeySchema,
  language: knowledgeLanguageV2Schema,
  kind: z.literal('translation'),
  state: z.enum(['reviewed', 'rejected']),
});
