import { z } from 'zod';

import {
  evidenceAnchorSchema,
  observationSchema,
  recordCheckSchema,
} from './media.js';
import {
  entityIdSchema,
  instantSchema,
  revisionSchema,
  cursorPageSchema,
  recordVersionsSchema,
  MAX_PAGE_SIZE,
} from './shared.js';
import { referenceImageSchema, sourceCitationSchema } from './source.js';

export const knowledgeKindSchema = z.enum([
  'material',
  'manufacture',
  'motif',
  'mark',
  'surface',
  'condition',
  'damage',
  'repair',
  'restoration',
  'inspection',
  'period',
  'object_type',
  'other',
]);
export const citedTextSchema = z
  .strictObject({
    textZhHant: z.string(),
    citationIds: z.array(entityIdSchema),
    support: z.enum(['cited', 'needs_source']),
  })
  .refine((text) => text.support !== 'cited' || text.citationIds.length > 0);
export const applicabilityContextSchema = z.strictObject({
  scope: z.enum(['general', 'specific']),
  objectTypeIds: z.array(entityIdSchema),
  materialIds: z.array(entityIdSchema),
  periodIds: z.array(entityIdSchema),
  regionIds: z.array(entityIdSchema),
  limits: citedTextSchema,
});
export const knowledgeContentSchema = z.strictObject({
  titleZhHant: z.string(),
  aliases: z.array(z.string()),
  kinds: z.array(knowledgeKindSchema),
  otherKindLabel: z.string().nullable(),
  summary: citedTextSchema,
  history: z.array(citedTextSchema),
  features: z.array(citedTextSchema),
  applicability: z.array(applicabilityContextSchema),
  exampleReferenceImageIds: z.array(entityIdSchema),
  relatedEntryIds: z.array(entityIdSchema),
  citations: z.array(sourceCitationSchema),
});
export const knowledgeEntrySchema = z.strictObject({
  id: entityIdSchema,
  revision: revisionSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
  displayCode: z.string(),
  status: z.enum(['draft', 'saved']),
  content: knowledgeContentSchema,
  methodIds: z.array(entityIdSchema),
  savedBy: z.literal('collector').nullable(),
});
export const inspectionMethodSchema = z.strictObject({
  id: entityIdSchema,
  owningEntryId: entityIdSchema,
  currentVersionId: entityIdSchema,
});
export const methodDefinitionSchema = z.strictObject({
  titleZhHant: z.string(),
  history: z.array(citedTextSchema),
  featureEntryIds: z.array(entityIdSchema),
  applicability: z.array(applicabilityContextSchema),
  observationModes: z.array(
    z.enum([
      'phone_photo',
      'video',
      'in_person_visual',
      'touch',
      'measurement',
      'document_review',
      'specialist_or_instrument',
    ]),
  ),
  steps: z.array(
    z.strictObject({
      order: z.int().positive(),
      actionZhHant: z.string(),
      evidenceToCaptureZhHant: z.string(),
    }),
  ),
  interpretationLimits: z.array(citedTextSchema),
  exampleReferenceImageIds: z.array(entityIdSchema),
  citations: z.array(sourceCitationSchema),
});
export const retrievedMethodSchema = z.strictObject({
  methodId: entityIdSchema,
  methodVersionId: entityIdSchema,
  owningEntryId: entityIdSchema,
  titleZhHant: z.string(),
  definition: methodDefinitionSchema,
});
export type RetrievedMethod = z.infer<typeof retrievedMethodSchema>;
export const inspectionMethodVersionSchema = z.strictObject({
  id: entityIdSchema,
  methodId: entityIdSchema,
  revision: revisionSchema,
  definition: methodDefinitionSchema,
  createdAt: instantSchema,
});
export const checkDetailSchema = z.strictObject({
  check: recordCheckSchema,
  method: inspectionMethodVersionSchema,
  observations: z.array(observationSchema),
  evidence: z.array(evidenceAnchorSchema),
  versions: recordVersionsSchema,
  methodUpdateAvailable: z.boolean(),
});
export type CheckDetail = z.infer<typeof checkDetailSchema>;
export const knowledgeDetailSchema = z.strictObject({
  entry: knowledgeEntrySchema,
  methods: z.array(inspectionMethodSchema),
  methodVersions: z.array(inspectionMethodVersionSchema),
  referenceImages: z.array(referenceImageSchema),
  citations: z.array(sourceCitationSchema),
});
export type KnowledgeDetail = z.infer<typeof knowledgeDetailSchema>;
export const knowledgeSummarySchema = z.strictObject({
  id: entityIdSchema,
  displayCode: z.string(),
  revision: revisionSchema,
  titleZhHant: z.string(),
  kinds: z.array(knowledgeKindSchema),
  status: z.enum(['draft', 'saved']),
  summaryZhHant: z.string(),
  citationCount: z.int().nonnegative(),
});
export type KnowledgeSummary = z.infer<typeof knowledgeSummarySchema>;
export const methodWriteSchema = z
  .strictObject({
    methodId: entityIdSchema.nullable(),
    expectedVersionId: entityIdSchema.nullable(),
    definition: methodDefinitionSchema,
  })
  .refine(
    (value) => (value.methodId === null) === (value.expectedVersionId === null),
  );
const knowledgeWriteShape = {
  requestKey: entityIdSchema,
  status: z.enum(['draft', 'saved']),
  content: knowledgeContentSchema,
  methodWrites: z.array(methodWriteSchema),
  linkedMethodIds: z.array(entityIdSchema),
  originResearchId: entityIdSchema.nullable(),
};
export const knowledgeWriteSchema = z.strictObject(knowledgeWriteShape);
export type KnowledgeWrite = z.infer<typeof knowledgeWriteSchema>;
export const knowledgeUpdateSchema = z.strictObject({
  ...knowledgeWriteShape,
  expectedRevision: revisionSchema,
});
export type KnowledgeUpdate = z.infer<typeof knowledgeUpdateSchema>;
export const explicitFiltersSchema = z.strictObject({
  objectTypeIds: z.array(entityIdSchema).optional(),
  materialIds: z.array(entityIdSchema).optional(),
  periodIds: z.array(entityIdSchema).optional(),
  regionIds: z.array(entityIdSchema).optional(),
  sourceIds: z.array(entityIdSchema).optional(),
  includeUnknown: z.boolean().optional(),
});
export const hypothesisHintsSchema = z.strictObject({
  analysisRunId: entityIdSchema,
  objectTypeIds: z.array(entityIdSchema),
  materialIds: z.array(entityIdSchema),
  periodIds: z.array(entityIdSchema),
});
export const knowledgeQuerySchema = z.strictObject({
  q: z.string().optional(),
  kinds: z.array(knowledgeKindSchema).optional(),
  status: z.enum(['draft', 'saved']).optional(),
  filters: explicitFiltersSchema.optional(),
  cursor: z.string().optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export const knowledgePageSchema = cursorPageSchema(knowledgeSummarySchema);
