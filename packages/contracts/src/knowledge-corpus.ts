import { z } from 'zod';

import {
  corpusGuideFieldSchema,
  corpusGuideGroupSchema,
} from './knowledge-corpus/guide-fields.js';
import {
  knowledgeClaimV2Schema,
  knowledgeLanguageV2Schema,
  knowledgeLocatorV2Schema,
  knowledgeVariantV2Schema,
} from './knowledge-v2.js';
import { instantSchema } from './shared.js';
import {
  canonicalJsonSchema,
  observedRightsSchema,
} from './source-structured.js';

export {
  corpusGuideFieldSchema,
  corpusGuideGroupSchema,
} from './knowledge-corpus/guide-fields.js';
export { filterGuideStatementsForRecord } from './knowledge-corpus/record-context.js';

const maximumTextLength = 24_000;
const maximumKeyLength = 200;
const categoryRootCount = 4;
const maximumRelevanceGrade = 3;

const contentIdSchema = z.string().regex(/^[a-z][a-z0-9_-]*:[^\s]+$/);
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const textSchema = z.string().min(1).max(maximumTextLength);
const urlSchema = z
  .string()
  .url()
  .regex(/^https?:/);
const utcInstantSchema = instantSchema.regex(/Z$/, 'Expected a UTC timestamp');
const reviewSchema = knowledgeClaimV2Schema.shape.review.safeExtend({
  at: utcInstantSchema.optional(),
});
const rightsSchema = observedRightsSchema.extend({
  observedAt: utcInstantSchema,
});
const variantSchema = knowledgeVariantV2Schema.extend({
  translatedAt: utcInstantSchema.optional(),
  review: reviewSchema,
});
const categorySchema = z.enum(['ceramics', 'bronzes', 'jades', 'furniture']);
const labelSchema = z.strictObject({
  language: knowledgeLanguageV2Schema,
  text: textSchema,
  kind: z.enum(['preferred', 'alias', 'original']),
});
const mappingSchema = z.strictObject({
  authority: z.enum(['wikidata', 'getty_aat', 'getty_ulan', 'getty_tgn']),
  authorityId: textSchema,
  uri: urlSchema,
  relation: z.enum(['exact', 'close', 'broader', 'related']),
  authorityVersion: textSchema.optional(),
  citationId: contentIdSchema,
  reviewState: z.enum(['pending', 'reviewed', 'rejected']),
  reviewedBy: textSchema.optional(),
  reviewedAt: utcInstantSchema.optional(),
});
const topicSchema = z.strictObject({
  id: contentIdSchema,
  facet: z.enum([
    'category',
    'material',
    'object_type',
    'period',
    'region',
    'kiln_maker',
    'technique',
    'motif',
    'mark',
    'surface',
    'condition',
    'repair_restoration',
    'authentication_limit',
    'provenance',
  ]),
  parentId: contentIdSchema.optional(),
  sortOrder: z.int().nonnegative(),
  labels: z.array(labelSchema).min(2),
  relatedIds: z.array(contentIdSchema),
  mappings: z.array(mappingSchema),
});
const locatorSchema = z.discriminatedUnion('kind', [
  knowledgeLocatorV2Schema.options[0]
    .omit({ sourceId: true, sourceVersionId: true })
    .extend({ id: contentIdSchema, retrievedAt: utcInstantSchema }),
  knowledgeLocatorV2Schema.options[1]
    .omit({ sourceId: true, sourceVersionId: true })
    .extend({
      id: contentIdSchema,
      retrievedAt: utcInstantSchema,
      section: textSchema,
    }),
  knowledgeLocatorV2Schema.options[2]
    .omit({ sourceId: true, sourceVersionId: true })
    .extend({
      id: contentIdSchema,
      pageId: contentIdSchema,
      pageIndex: z.int().nonnegative().optional(),
    })
    .refine(
      (locator) =>
        locator.pageIndex !== undefined ||
        Boolean(locator.printedPageLabel?.trim()),
      {
        message:
          'A page without a verified scan index requires its printed page label',
        path: ['printedPageLabel'],
      },
    ),
]);
const citationSchema = z.strictObject({
  id: contentIdSchema,
  sourceContentId: contentIdSchema,
  payloadHash: hashSchema,
  locatorId: contentIdSchema,
  relation: z.enum(['supports', 'background', 'comparison']),
  quote: textSchema,
  attributedOpinion: z.boolean().optional(),
  verdictLanguage: z.boolean().optional(),
});
const imageSchema = z.strictObject({
  id: contentIdSchema,
  remoteUrl: urlSchema,
  sourcePageUrl: urlSchema,
  provider: textSchema,
  providerImageId: textSchema.optional(),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  rights: rightsSchema.optional(),
  lastCheckedAt: utcInstantSchema.optional(),
  status: z.enum(['unchecked', 'available', 'unavailable', 'removed']),
  locatorId: contentIdSchema.optional(),
  showable: z.boolean().optional(),
  role: z.enum(['typical', 'warning']).optional(),
});
const claimSchema = knowledgeClaimV2Schema.extend({
  citationIds: z.array(contentIdSchema),
  review: reviewSchema,
  variants: knowledgeClaimV2Schema.shape.variants.and(z.array(variantSchema)),
});

/** versioned taxonomy labels, hierarchy, and authority evidence */
export const corpusTaxonomySchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('taxonomy'),
  topics: z.array(topicSchema).min(categoryRootCount),
});
/** immutable metadata snapshot; image records contain URLs only */
export const corpusSourceSchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('source'),
  id: contentIdSchema,
  provider: textSchema,
  objectId: textSchema,
  sourcePageUrl: urlSchema,
  title: textSchema,
  languages: z.array(knowledgeLanguageV2Schema).min(1),
  contributors: z.array(textSchema),
  retrievedAt: utcInstantSchema,
  payloadHash: hashSchema,
  providerSchemaVersion: textSchema,
  payload: canonicalJsonSchema,
  rights: rightsSchema.optional(),
  licenceBasis: z
    .enum(['public_domain', 'open_license', 'collector_authorization'])
    .optional(),
  authorizationNote: textSchema.optional(),
  fieldRights: z.array(rightsSchema),
  locators: z.array(locatorSchema),
  citations: z.array(citationSchema),
  images: z.array(imageSchema),
});
/** curated content installed as an owner draft by the future installer */
export const corpusEntrySchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('entry'),
  id: contentIdSchema,
  contentSchemaVersion: z.literal(2),
  entryType: z.enum(['concept', 'method', 'object_example']),
  category: categorySchema,
  titles: z
    .array(labelSchema.extend({ editorial: z.literal(true).optional() }))
    .min(1),
  aliases: z.array(labelSchema),
  topics: z.array(
    z.strictObject({
      topicId: contentIdSchema,
      applicability: z.enum(['general', 'specific']),
      uncertainty: textSchema.optional(),
    }),
  ),
  claims: z.array(claimSchema).min(1),
  imageIds: z.array(contentIdSchema),
  externalObjectIds: z.array(contentIdSchema),
  editorialReview: reviewSchema,
});
/** preserves claim evidence and original bytes while assigning a guide field */
export const corpusGuideStatementSchema = claimSchema
  .omit({ section: true })
  .extend({
    field: corpusGuideFieldSchema,
    attributedOpinion: z.boolean().optional(),
    verdictLanguage: z.boolean().optional(),
  });
const guideCheckSchema = z.strictObject({
  checkKey: z.string().min(1).max(maximumKeyLength),
  group: corpusGuideGroupSchema,
  ordinal: z.int().nonnegative(),
  labels: z.array(labelSchema).min(2),
  statements: z.array(corpusGuideStatementSchema).min(1),
  imageIds: z.array(contentIdSchema),
  relatedEntryIds: z.array(contentIdSchema),
  capture: z
    .strictObject({
      view: z.enum([
        'overall',
        'base',
        'interior',
        'detail',
        'mark',
        'underside',
        'joint',
      ]),
      light: z.enum(['diffuse', 'raking', 'transmitted', 'any']).optional(),
      magnification: z.enum(['none', 'loupe_10x', 'microscope']).optional(),
    })
    .optional(),
  gap: z
    .strictObject({
      fields: z.array(corpusGuideFieldSchema).min(1),
      need: textSchema,
      ownerSourceHint: textSchema.optional(),
    })
    .optional(),
});
/** reference guidance kept outside owner knowledge drafts and machine verdicts */
export const corpusExaminationGuideSchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('examination_guide'),
  id: contentIdSchema,
  guideVersion: z.int().positive(),
  category: categorySchema,
  titles: z.array(labelSchema).min(2),
  appliesToTopicIds: z.array(contentIdSchema).min(1),
  framing: z.literal('observation_not_verdict'),
  checks: z.array(guideCheckSchema).min(1),
  externalObjectIds: z.array(contentIdSchema),
  editorialReview: reviewSchema,
});
/** exact-byte members and canonical self-excluding manifest digest */
export const corpusReleaseSchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('release'),
  corpusId: contentIdSchema,
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  publishedAt: utcInstantSchema.optional(),
  reviewer: textSchema.optional(),
  files: z.array(z.strictObject({ path: textSchema, sha256: hashSchema })),
  manifestHash: hashSchema,
  rightsNotices: z.array(rightsSchema),
});
/** owner questions; provisional research judgments are distinct from owner gold */
export const corpusQueriesSchema = z.strictObject({
  formatVersion: z.literal(1),
  kind: z.literal('owner_queries'),
  provisional: z.boolean(),
  questions: z.array(
    z.strictObject({
      id: contentIdSchema,
      category: categorySchema,
      language: knowledgeLanguageV2Schema,
      text: textSchema,
      relevance: z
        .array(
          z.strictObject({
            entryId: contentIdSchema,
            grade: z.int().min(0).max(maximumRelevanceGrade),
          }),
        )
        .min(1),
    }),
  ),
});
/** strict on-disk corpus contract, including graded owner queries */
export const corpusFileSchema = z.discriminatedUnion('kind', [
  corpusTaxonomySchema,
  corpusSourceSchema,
  corpusEntrySchema,
  corpusReleaseSchema,
  corpusQueriesSchema,
  corpusExaminationGuideSchema,
]);

export type CorpusFile = z.infer<typeof corpusFileSchema>;
export type CorpusTaxonomy = z.infer<typeof corpusTaxonomySchema>;
export type CorpusSource = z.infer<typeof corpusSourceSchema>;
export type CorpusEntry = z.infer<typeof corpusEntrySchema>;
export type CorpusRelease = z.infer<typeof corpusReleaseSchema>;
export type CorpusQueries = z.infer<typeof corpusQueriesSchema>;

export type CorpusExaminationGuide = z.infer<
  typeof corpusExaminationGuideSchema
>;
export type CorpusGuideStatement = z.infer<typeof corpusGuideStatementSchema>;
