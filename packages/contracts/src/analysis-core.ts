import { z } from 'zod';

import { periodSchema, recordFieldsSchema } from './record.js';
import {
  entityIdSchema,
  recordVersionsSchema,
  revisionSchema,
} from './shared.js';

export const requestAnalysisSchema = z.strictObject({
  expectedRecordRevision: revisionSchema,
  inputSnapshotId: entityIdSchema.optional(),
  modelId: z.string().optional(),
});
export type RequestAnalysis = z.infer<typeof requestAnalysisSchema>;
export const analysisAcceptedSchema = z.strictObject({
  runId: entityIdSchema,
  jobId: entityIdSchema,
  status: z.literal('queued'),
  inputSnapshotId: entityIdSchema,
  analysisInputVersion: revisionSchema,
});
export type AnalysisAccepted = z.infer<typeof analysisAcceptedSchema>;
export const analysisInputSchema = z.strictObject({
  recordId: entityIdSchema,
  snapshotId: entityIdSchema,
  recordRevision: revisionSchema,
  analysisInputVersion: revisionSchema,
  evidenceVersion: revisionSchema,
  assetIds: z.array(entityIdSchema),
  evidenceIds: z.array(entityIdSchema),
  observationIds: z.array(entityIdSchema),
  checkIds: z.array(entityIdSchema),
  retrievalSnapshotId: entityIdSchema,
  promptVersion: z.string(),
  schemaVersion: z.string(),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;
export const findingSchema = z.strictObject({
  id: entityIdSchema,
  kind: z.enum([
    'visualObservation',
    'collectorObservation',
    'sourceStatement',
    'hypothesis',
  ]),
  text: z.string(),
  evidenceIds: z.array(entityIdSchema),
  observationIds: z.array(entityIdSchema),
  citationIds: z.array(entityIdSchema),
  relation: z.enum(['supports', 'contradicts', 'context']),
  certainty: z.enum(['observed', 'reported', 'tentative', 'undetermined']),
});
export type Finding = z.infer<typeof findingSchema>;
export const nextActionSchema = z.strictObject({
  id: entityIdSchema,
  checkId: entityIdSchema.optional(),
  kind: z.enum([
    'capturePhoto',
    'selectVideoFrame',
    'describe',
    'confirmFeature',
    'inspectSource',
  ]),
  instruction: z.string(),
  reason: z.string(),
});
export type NextAction = z.infer<typeof nextActionSchema>;
const proposedChangeBase = {
  id: entityIdSchema,
  findingIds: z.array(entityIdSchema),
};
export const proposedChangeSchema = z.discriminatedUnion('field', [
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('name'),
    before: recordFieldsSchema.shape.name,
    proposed: recordFieldsSchema.shape.name,
  }),
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('description'),
    before: recordFieldsSchema.shape.description,
    proposed: recordFieldsSchema.shape.description,
  }),
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('materialIds'),
    before: recordFieldsSchema.shape.materialIds,
    proposed: recordFieldsSchema.shape.materialIds,
  }),
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('period'),
    before: periodSchema.nullable(),
    proposed: periodSchema.nullable(),
  }),
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('tags'),
    before: recordFieldsSchema.shape.tags,
    proposed: recordFieldsSchema.shape.tags,
  }),
  z.strictObject({
    ...proposedChangeBase,
    field: z.literal('collectorJudgment'),
    before: recordFieldsSchema.shape.collectorJudgment,
    proposed: recordFieldsSchema.shape.collectorJudgment,
  }),
]);
export type ProposedChange = z.infer<typeof proposedChangeSchema>;
export const analysisOutputSchema = z.strictObject({
  summary: z.string(),
  findings: z.array(findingSchema),
  uncertainties: z.array(z.string()),
  suggestedMethodIds: z.array(entityIdSchema),
  nextActions: z.array(nextActionSchema),
  proposedChanges: z.array(proposedChangeSchema),
});
export type AnalysisOutput = z.infer<typeof analysisOutputSchema>;
export const editDraftResultSchema = z.strictObject({
  editDraftId: entityIdSchema,
  recordId: entityIdSchema,
  baseVersions: recordVersionsSchema,
  sourceTranscriptionIds: z.array(entityIdSchema),
  sourceObservationIds: z.array(entityIdSchema),
  /** the assistant's text answer to the instruction; results stored before replies existed read as empty */
  replyZhHant: z.string().default(''),
  suggestedDescriptionZhHant: z.string(),
  proposedChanges: z.array(proposedChangeSchema),
});
export type EditDraftResult = z.infer<typeof editDraftResultSchema>;

export interface AnalysisReferenceSet {
  readonly evidenceIds: ReadonlySet<string>;
  readonly observationIds: ReadonlySet<string>;
  readonly citationIds: ReadonlySet<string>;
  readonly checkIds: ReadonlySet<string>;
  readonly methodIds: ReadonlySet<string>;
}
export type AnalysisValidationResult =
  | { readonly valid: true; readonly output: AnalysisOutput }
  | { readonly valid: false; readonly issues: readonly string[] };

/**
 * validates a model response and all of its references against the frozen input
 * @param value Model response to validate.
 * @param allowed References available to this analysis run.
 * @returns parsed output or validation issues
 */
export function validateAnalysisOutput(
  value: unknown,
  allowed: AnalysisReferenceSet,
): AnalysisValidationResult {
  const parsed = analysisOutputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  const rejected = validateAnalysisReferences(parsed.data, allowed);

  return rejected.length === 0
    ? { valid: true, output: parsed.data }
    : {
        valid: false,
        issues: rejected.map((id) => `Invalid analysis reference: ${id}`),
      };
}
/**
 * appends identifiers that are absent from a frozen allowed-reference set
 * @param ids Referenced identifiers to inspect.
 * @param allowed Allowed identifiers from the input snapshot.
 * @param rejected Mutable list of rejected identifiers.
 */
function collectUnknownReferences(
  ids: readonly string[],
  allowed: ReadonlySet<string>,
  rejected: string[],
): void {
  for (const id of ids) {
    if (!allowed.has(id)) {
      rejected.push(id);
    }
  }
}

/**
 * finds unsupported references and findings without their required support
 * @param output Parsed analysis output.
 * @param allowed References available to this analysis run.
 * @returns rejected reference or finding IDs
 */
export function validateAnalysisReferences(
  output: AnalysisOutput,
  allowed: AnalysisReferenceSet,
): readonly string[] {
  const rejected: string[] = [];
  for (const finding of output.findings) {
    collectUnknownReferences(
      finding.evidenceIds,
      allowed.evidenceIds,
      rejected,
    );
    collectUnknownReferences(
      finding.observationIds,
      allowed.observationIds,
      rejected,
    );
    collectUnknownReferences(
      finding.citationIds,
      allowed.citationIds,
      rejected,
    );
    if (
      finding.kind === 'sourceStatement' &&
      finding.citationIds.length === 0
    ) {
      rejected.push(finding.id);
    }
    if (
      finding.kind === 'visualObservation' &&
      finding.evidenceIds.length === 0
    ) {
      rejected.push(finding.id);
    }
    if (
      finding.kind === 'collectorObservation' &&
      finding.observationIds.length === 0
    ) {
      rejected.push(finding.id);
    }
  }
  const findingIds = new Set(output.findings.map((finding) => finding.id));
  for (const change of output.proposedChanges) {
    collectUnknownReferences(change.findingIds, findingIds, rejected);
  }
  for (const action of output.nextActions) {
    if (action.checkId !== undefined && !allowed.checkIds.has(action.checkId)) {
      rejected.push(action.checkId);
    }
  }
  collectUnknownReferences(
    output.suggestedMethodIds,
    allowed.methodIds,
    rejected,
  );

  return rejected;
}
