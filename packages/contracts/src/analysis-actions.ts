import { z } from 'zod';

import { analysisOutputSchema, nextActionSchema } from './analysis-core.js';
import { recordCheckSchema } from './media.js';
import {
  cursorPageSchema,
  entityIdSchema,
  instantSchema,
  recordVersionsSchema,
  revisionSchema,
  MAX_PAGE_SIZE,
} from './shared.js';
import { sourceCitationSchema } from './source.js';

export const applyAnalysisChangesSchema = z
  .strictObject({
    expectedRecordRevision: revisionSchema,
    selectedProposalIds: z.array(entityIdSchema),
    skippedProposalIds: z.array(entityIdSchema).optional(),
  })
  .refine(
    (value) =>
      !value.skippedProposalIds?.some((id) =>
        value.selectedProposalIds.includes(id),
      ),
  );
export type ApplyAnalysisChanges = z.infer<typeof applyAnalysisChangesSchema>;
export const actionSupportSchema = z.strictObject({
  evidenceAnchorIds: z.array(entityIdSchema).optional(),
  observationIds: z.array(entityIdSchema).optional(),
  referenceLinkIds: z.array(entityIdSchema).optional(),
  checkIds: z.array(entityIdSchema).optional(),
  onSiteDescription: z.string().optional(),
});
export type ActionSupport = z.infer<typeof actionSupportSchema>;
const actionRequestBase = {
  expectedActionRevision: revisionSchema,
  expectedRecordRevision: revisionSchema,
  support: actionSupportSchema.optional(),
};
/**
 * checks whether a collector supplied any concrete support for an action
 * @param support Submitted action support, if present.
 * @returns whether at least one support item is populated
 */
function hasActionSupport(support: ActionSupport | undefined): boolean {
  if (!support) {
    return false;
  }

  return (
    (support.evidenceAnchorIds?.length ?? 0) > 0 ||
    (support.observationIds?.length ?? 0) > 0 ||
    (support.referenceLinkIds?.length ?? 0) > 0 ||
    (support.checkIds?.length ?? 0) > 0 ||
    Boolean(support.onSiteDescription?.trim())
  );
}
export const actionResolutionRequestSchema = z.discriminatedUnion('status', [
  z
    .strictObject({ ...actionRequestBase, status: z.literal('supplied') })
    .refine((value) => hasActionSupport(value.support)),
  z.strictObject({
    ...actionRequestBase,
    status: z.literal('dismissed'),
    reason: z.string().trim().min(1),
  }),
]);
export type ActionResolutionRequest = z.infer<
  typeof actionResolutionRequestSchema
>;
export const actionStateSchema = z.strictObject({
  runId: entityIdSchema,
  actionId: entityIdSchema,
  recordId: entityIdSchema,
  revision: revisionSchema,
  status: z.enum(['pending', 'supplied', 'dismissed']),
  latestResolutionId: entityIdSchema.nullable(),
  updatedAt: instantSchema,
});
export type ActionState = z.infer<typeof actionStateSchema>;
export const actionResolutionSchema = z.strictObject({
  id: entityIdSchema,
  runId: entityIdSchema,
  actionId: entityIdSchema,
  recordId: entityIdSchema,
  actionRevision: revisionSchema,
  status: z.enum(['supplied', 'dismissed']),
  support: actionSupportSchema,
  reason: z.string().nullable(),
  resolvedBy: z.literal('collector'),
  resolvedAt: instantSchema,
  recordRevision: revisionSchema,
});
export type ActionResolution = z.infer<typeof actionResolutionSchema>;
export const actionResolutionResultSchema = z.strictObject({
  state: actionStateSchema,
  resolution: actionResolutionSchema,
  versions: recordVersionsSchema,
});
export type ActionResolutionResult = z.infer<
  typeof actionResolutionResultSchema
>;
export const proposalStateSchema = z.strictObject({
  proposalId: entityIdSchema,
  status: z.enum(['pending', 'accepted', 'skipped']),
  latestAdoptionEventId: entityIdSchema.nullable(),
});
export type ProposalState = z.infer<typeof proposalStateSchema>;
export const analysisResultProjectionSchema = z.strictObject({
  output: analysisOutputSchema.nullable(),
  actionStates: z.array(actionStateSchema),
  proposalStates: z.array(proposalStateSchema),
});
export type AnalysisResultProjection = z.infer<
  typeof analysisResultProjectionSchema
>;
export const analysisRunDetailSchema = z.strictObject({
  runId: entityIdSchema,
  recordId: entityIdSchema,
  jobId: entityIdSchema,
  status: z.enum(['queued', 'running', 'completed', 'partial', 'failed']),
  snapshot: z.strictObject({
    id: entityIdSchema,
    recordRevision: revisionSchema,
    analysisInputVersion: revisionSchema,
    evidenceVersion: revisionSchema,
    assetIds: z.array(entityIdSchema),
    evidenceIds: z.array(entityIdSchema),
    observationIds: z.array(entityIdSchema),
    checkIds: z.array(entityIdSchema),
    retrievalSnapshotId: entityIdSchema.nullable(),
  }),
  citations: z.array(sourceCitationSchema),
  suggestedMethods: z.array(
    z.strictObject({
      methodId: entityIdSchema,
      methodVersionId: entityIdSchema,
      owningEntryId: entityIdSchema,
      titleZhHant: z.string(),
    }),
  ),
  invocation: z.lazy(() => modelInvocationSchema).nullable(),
  failureAudits: z.array(z.lazy(() => modelFailureAuditSchema)),
  result: analysisResultProjectionSchema,
});
export type AnalysisRunDetail = z.infer<typeof analysisRunDetailSchema>;
export const inspectionTaskSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('analysisAction'),
    recordId: entityIdSchema,
    runId: entityIdSchema,
    action: nextActionSchema,
    state: actionStateSchema,
    latestResolution: actionResolutionSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal('recordCheck'),
    recordId: entityIdSchema,
    check: recordCheckSchema,
  }),
]);
export type InspectionTask = z.infer<typeof inspectionTaskSchema>;
export const taskQuerySchema = z.strictObject({
  recordId: entityIdSchema.optional(),
  actionStatus: actionStateSchema.shape.status.optional(),
  cursor: z.string().optional(),
  limit: z.int().min(1).max(MAX_PAGE_SIZE).optional(),
});
export type TaskQuery = z.infer<typeof taskQuerySchema>;
export const taskPageSchema = cursorPageSchema(inspectionTaskSchema);
export type TaskPage = z.infer<typeof taskPageSchema>;
export const modelRoleSchema = z.enum([
  'analysis',
  'research',
  'recordEditing',
  'transcription',
]);
export type ModelRole = z.infer<typeof modelRoleSchema>;
export const modelSelectionSchema = z.strictObject({
  role: modelRoleSchema,
  modelId: z.string(),
  profileVersion: z.string(),
});
export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export const modelCapabilitiesSchema = z.strictObject({
  textInput: z.boolean(),
  imageInput: z.boolean(),
  audioInput: z.boolean(),
  structuredOutput: z.boolean(),
  toolCalling: z.boolean(),
  maxContextTokens: z.int().positive().optional(),
  maxImages: z.int().nonnegative().optional(),
});
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export const modelInvocationSchema = z.strictObject({
  requestedModelId: z.string(),
  effectiveModelId: z.string(),
  provider: z.string(),
  providerModelVersion: z.string().nullable(),
  adapterKind: z.enum(['live', 'development']),
  capabilities: modelCapabilitiesSchema,
  role: modelRoleSchema,
  profileVersion: z.string(),
  promptVersion: z.string(),
  schemaVersion: z.string(),
  effectiveOptions: z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
  latencyMs: z.number().nonnegative(),
  usage: z.strictObject({
    inputTokens: z.int().nonnegative().nullable(),
    outputTokens: z.int().nonnegative().nullable(),
  }),
  finishReason: z.string().nullable(),
  citationCheck: z.strictObject({
    valid: z.boolean(),
    rejectedReferenceIds: z.array(entityIdSchema),
  }),
});
export type ModelInvocation = z.infer<typeof modelInvocationSchema>;
export const modelFailureAuditSchema = z.strictObject({
  invocation: modelInvocationSchema.nullable(),
  rawOutput: z.unknown(),
});
export type ModelFailureAudit = z.infer<typeof modelFailureAuditSchema>;
