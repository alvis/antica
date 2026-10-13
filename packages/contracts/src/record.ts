import { z } from 'zod';

import {
  cursorPageSchema,
  entityIdSchema,
  instantSchema,
  revisionSchema,
  MAX_PAGE_SIZE,
} from './shared.js';

const lengthMeasurementSchema = z.strictObject({
  value: z.number().positive(),
  unit: z.enum(['mm', 'cm', 'm']),
  componentId: entityIdSchema.optional(),
});
const weightMeasurementSchema = z.strictObject({
  value: z.number().positive(),
  unit: z.enum(['g', 'kg']),
  componentId: entityIdSchema.optional(),
});
export const measurementSchema = z.union([
  lengthMeasurementSchema,
  weightMeasurementSchema,
]);
export type Measurement = z.infer<typeof measurementSchema>;
export const periodSchema = z
  .strictObject({
    label: z.string(),
    fromYear: z.int().optional(),
    toYear: z.int().optional(),
    status: z.enum(['collectorClaim', 'unconfirmed']),
  })
  .refine(
    (period) =>
      period.fromYear === undefined ||
      period.toYear === undefined ||
      period.fromYear <= period.toYear,
  );
export const recordFieldsSchema = z.strictObject({
  name: z.string().nullable(),
  unitKind: z.enum(['single', 'set']),
  components: z.array(
    z.strictObject({ id: entityIdSchema, label: z.string() }),
  ),
  pieceCount: z.int().positive().nullable(),
  categoryIds: z.array(entityIdSchema),
  materialIds: z.array(entityIdSchema),
  period: periodSchema.nullable(),
  dimensions: z.strictObject({
    height: lengthMeasurementSchema.optional(),
    width: lengthMeasurementSchema.optional(),
    depth: lengthMeasurementSchema.optional(),
    diameter: lengthMeasurementSchema.optional(),
    weight: weightMeasurementSchema.optional(),
  }),
  location: z.strictObject({
    locationId: entityIdSchema.nullable(),
    detail: z.string(),
  }),
  acquisition: z
    .strictObject({
      acquiredOn: z.iso.date().optional(),
      seller: z.string().optional(),
      method: z.string().optional(),
      amount: z
        .string()
        .regex(/^\d+(?:\.\d+)?$/)
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      receiptAssetIds: z.array(entityIdSchema),
      provenanceNote: z.string().optional(),
    })
    .refine(
      (value) =>
        (value.amount === undefined) === (value.currency === undefined),
    ),
  tags: z.array(z.string()),
  description: z.string(),
  collectorJudgment: z.string().nullable(),
});
export type RecordFields = z.infer<typeof recordFieldsSchema>;
export const recordDetailSchema = recordFieldsSchema.safeExtend({
  id: entityIdSchema,
  code: z.string(),
  recordRevision: revisionSchema,
  analysisInputVersion: revisionSchema,
  evidenceVersion: revisionSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
  mediaIds: z.array(entityIdSchema),
  checkIds: z.array(entityIdSchema),
  latestRunId: entityIdSchema.nullable(),
  analysisFreshness: z.enum(['unanalyzed', 'current', 'outdated']),
});
export type RecordDetail = z.infer<typeof recordDetailSchema>;
export const recordCreateSchema = recordFieldsSchema
  .partial()
  .required({ unitKind: true });
export type RecordCreate = z.infer<typeof recordCreateSchema>;
export const recordPatchSchema = z
  .strictObject({
    expectedRevision: revisionSchema,
    fields: recordFieldsSchema.partial(),
    editDraftId: entityIdSchema.optional(),
    acceptedProposalIds: z.array(entityIdSchema).optional(),
  })
  .refine(
    (value) =>
      (value.editDraftId === undefined) ===
      (value.acceptedProposalIds === undefined),
  );
export type RecordPatch = z.infer<typeof recordPatchSchema>;
export const collectionQuerySchema = z.strictObject({
  cursor: z.string().optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
  text: z.string().optional(),
  categoryIds: z.array(entityIdSchema).optional(),
  materialIds: z.array(entityIdSchema).optional(),
  periodIds: z.array(entityIdSchema).optional(),
  locationId: entityIdSchema.nullable().optional(),
  tags: z.array(z.string()).optional(),
  freshness: z.enum(['unanalyzed', 'current', 'outdated']).optional(),
  hasPendingChecks: z.boolean().optional(),
  sort: z.enum(['updated', 'code', 'name']).optional(),
});
export type CollectionQuery = z.infer<typeof collectionQuerySchema>;
export const recordSummarySchema = z.strictObject({
  id: entityIdSchema,
  code: z.string(),
  name: z.string().nullable(),
  coverThumbnail: z.string().nullable(),
  locationLabel: z.string().nullable(),
  analysisFreshness: z.enum(['unanalyzed', 'current', 'outdated']),
  pendingCheckCount: z.int().nonnegative(),
});
export type RecordSummary = z.infer<typeof recordSummarySchema>;
export const recordPageSchema = cursorPageSchema(recordSummarySchema);
export const locationSchema = z.strictObject({
  id: entityIdSchema,
  label: z.string().min(1),
});
export type Location = z.infer<typeof locationSchema>;
export const locationCreateSchema = z.strictObject({
  label: z.string().trim().min(1),
});
export type LocationCreate = z.infer<typeof locationCreateSchema>;
export const locationsSchema = z.array(locationSchema);
