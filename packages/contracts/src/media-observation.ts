import { z } from 'zod';

import { entityIdSchema, instantSchema, revisionSchema } from './shared.js';

export const observationInputSchema = z.strictObject({
  recordId: entityIdSchema,
  componentIds: z.array(entityIdSchema),
  channel: z.enum(['typed', 'voice', 'feature_confirmation']),
  text: z.string(),
  evidenceAnchorIds: z.array(entityIdSchema),
  checkIds: z.array(entityIdSchema),
  observedAt: instantSchema,
  voice: z
    .strictObject({
      audioAssetId: entityIdSchema,
      transcriptionId: entityIdSchema,
      segmentId: entityIdSchema.nullable(),
    })
    .nullable(),
  editDraftId: entityIdSchema.nullable(),
  supersedesObservationId: entityIdSchema.nullable(),
});
export type ObservationInput = z.infer<typeof observationInputSchema>;
export const observationSchema = observationInputSchema.safeExtend({
  id: entityIdSchema,
  author: z.literal('collector'),
  createdAt: instantSchema,
  supersededByObservationId: entityIdSchema.nullable(),
});
export type Observation = z.infer<typeof observationSchema>;
export const observationPageSchema = z.strictObject({
  items: z.array(observationSchema),
  nextCursor: z.string().nullable(),
});
export const checkResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unrecorded') }),
  z.strictObject({ kind: z.literal('present') }),
  z.strictObject({ kind: z.literal('absent') }),
  z.strictObject({
    kind: z.literal('undetermined'),
    reason: z.string().trim().min(1),
  }),
  z.strictObject({
    kind: z.literal('not_applicable'),
    reason: z.string().trim().min(1),
  }),
]);
export const recordCheckSchema = z.strictObject({
  id: entityIdSchema,
  revision: revisionSchema,
  createdAt: instantSchema,
  updatedAt: instantSchema,
  recordId: entityIdSchema,
  componentIds: z.array(entityIdSchema),
  methodId: entityIdSchema,
  methodVersionId: entityIdSchema,
  suggestedByRunId: entityIdSchema.nullable(),
  progress: z.enum(['not_started', 'in_progress', 'recorded']),
  result: checkResultSchema,
  observationIds: z.array(entityIdSchema),
  evidenceAnchorIds: z.array(entityIdSchema),
  pendingActionIds: z.array(entityIdSchema),
});
export type RecordCheck = z.infer<typeof recordCheckSchema>;
export const checkCreateSchema = z.strictObject({
  expectedRecordRevision: revisionSchema,
  methodId: entityIdSchema,
  methodVersionId: entityIdSchema,
  componentIds: z.array(entityIdSchema).optional(),
  suggestedByRunId: entityIdSchema.optional(),
});
export type CheckCreate = z.infer<typeof checkCreateSchema>;
export const checkPatchSchema = z.strictObject({
  requestKey: entityIdSchema,
  expectedRevision: revisionSchema,
  expectedRecordRevision: revisionSchema,
  progress: z.enum(['not_started', 'in_progress', 'recorded']).optional(),
  result: checkResultSchema.optional(),
  addObservationIds: z.array(entityIdSchema).optional(),
  addEvidenceAnchorIds: z.array(entityIdSchema).optional(),
  newObservation: observationInputSchema.optional(),
});
export type CheckPatch = z.infer<typeof checkPatchSchema>;
export const transcriptionRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  recordId: entityIdSchema,
  audioAssetId: entityIdSchema,
  vocabularyHints: z.array(z.string()),
});
export type TranscriptionRequest = z.infer<typeof transcriptionRequestSchema>;
export const transcriptionResultSchema = z.strictObject({
  transcriptionId: entityIdSchema,
  recordId: entityIdSchema,
  audioAssetId: entityIdSchema,
  originalText: z.string(),
  readingTextZhHant: z.string(),
  detectedLanguages: z.array(z.string()),
  uncertainTerms: z.array(z.string()),
  segments: z.array(
    z.strictObject({
      id: entityIdSchema,
      startMs: z.number().nonnegative(),
      endMs: z.number().nonnegative(),
      originalText: z.string(),
    }),
  ),
});
export type TranscriptionResult = z.infer<typeof transcriptionResultSchema>;
export const editDraftRequestSchema = z.strictObject({
  requestKey: entityIdSchema,
  recordId: entityIdSchema,
  expectedRecordRevision: revisionSchema,
  transcriptionIds: z.array(entityIdSchema),
  observationIds: z.array(entityIdSchema),
  instructionZhHant: z.string(),
});
export type EditDraftRequest = z.infer<typeof editDraftRequestSchema>;
