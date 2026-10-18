import { z } from 'zod';

import { editDraftResultSchema, modelInvocationSchema } from './analysis.js';
import {
  observationSchema,
  transcriptionRequestSchema,
  transcriptionResultSchema,
} from './media.js';
import { recordDetailSchema, recordFieldsSchema } from './record.js';
import {
  entityIdSchema,
  instantSchema,
  recordVersionsSchema,
  revisionSchema,
} from './shared.js';

export const transcriptionSubmitSchema = transcriptionRequestSchema.safeExtend({
  expectedRecordRevision: revisionSchema,
});
export type TranscriptionSubmit = z.infer<typeof transcriptionSubmitSchema>;
export const transcriptionAcceptedSchema = z.strictObject({
  transcriptionId: entityIdSchema,
  jobId: entityIdSchema,
});
export type TranscriptionAccepted = z.infer<typeof transcriptionAcceptedSchema>;
export const transcriptionSnapshotSchema = z.strictObject({
  recordId: entityIdSchema,
  recordRevision: revisionSchema,
  audioAssetId: entityIdSchema,
  audioSha256: z.string().regex(/^[0-9a-f]{64}$/i),
  createdAt: instantSchema,
});
export const transcriptionDetailSchema = z.strictObject({
  transcriptionId: entityIdSchema,
  jobId: entityIdSchema,
  revision: revisionSchema,
  status: z.enum(['pending', 'ready', 'confirmed']),
  snapshot: transcriptionSnapshotSchema,
  result: transcriptionResultSchema.nullable(),
  invocation: modelInvocationSchema.nullable(),
  confirmedObservationId: entityIdSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});
export type TranscriptionDetail = z.infer<typeof transcriptionDetailSchema>;
export const transcriptionConfirmSchema = z.strictObject({
  requestKey: entityIdSchema,
  expectedRevision: revisionSchema,
  expectedRecordRevision: revisionSchema,
  adoptedTextZhHant: z.string().trim().min(1),
  componentIds: z.array(entityIdSchema),
  evidenceAnchorIds: z.array(entityIdSchema),
  checkIds: z.array(entityIdSchema),
  observedAt: instantSchema,
});
export type TranscriptionConfirm = z.infer<typeof transcriptionConfirmSchema>;
export const transcriptionConfirmedSchema = z.strictObject({
  transcription: transcriptionDetailSchema,
  observation: observationSchema,
  versions: recordVersionsSchema,
});
export type TranscriptionConfirmed = z.infer<
  typeof transcriptionConfirmedSchema
>;

export const editDraftAcceptedSchema = z.strictObject({
  editDraftId: entityIdSchema,
  jobId: entityIdSchema,
});
export type EditDraftAccepted = z.infer<typeof editDraftAcceptedSchema>;
export const editDraftSnapshotSchema = z.strictObject({
  recordId: entityIdSchema,
  versions: recordVersionsSchema,
  fields: recordFieldsSchema,
  transcriptionVersions: z.array(
    z.strictObject({ id: entityIdSchema, revision: revisionSchema }),
  ),
  observationIds: z.array(entityIdSchema),
  sourceText: z.array(
    z.strictObject({
      kind: z.enum(['transcription', 'observation']),
      id: entityIdSchema,
      text: z.string(),
    }),
  ),
  createdAt: instantSchema,
});
export const editDraftDetailSchema = z.strictObject({
  editDraftId: entityIdSchema,
  jobId: entityIdSchema,
  revision: revisionSchema,
  status: z.enum(['pending', 'ready', 'partially_applied', 'applied']),
  snapshot: editDraftSnapshotSchema,
  result: editDraftResultSchema.nullable(),
  invocation: modelInvocationSchema.nullable(),
  appliedProposalIds: z.array(entityIdSchema),
  createdAt: instantSchema,
  updatedAt: instantSchema,
});
export type EditDraftDetail = z.infer<typeof editDraftDetailSchema>;
export const editDraftApplySchema = z.strictObject({
  requestKey: entityIdSchema,
  expectedDraftRevision: revisionSchema,
  // revision displayed when the collector tapped apply (stale-screen guard);
  // each proposal's `before` guards against stale proposals per field
  expectedRecordRevision: revisionSchema,
  selectedProposalIds: z.array(entityIdSchema).min(1),
});
export type EditDraftApply = z.infer<typeof editDraftApplySchema>;
export const editDraftAppliedSchema = z.strictObject({
  draft: editDraftDetailSchema,
  record: recordDetailSchema,
});
export type EditDraftApplied = z.infer<typeof editDraftAppliedSchema>;
