import { isDeepStrictEqual } from 'node:util';

import {
  analysisOutputSchema,
  validateAnalysisReferences,
} from '@antica/contracts';

import type {
  AnalysisEvidencePack,
  OperationResult,
} from '@antica/application/ports';
import type { AnalysisOutput } from '@antica/contracts';

/**
 * validates generated shape and links only to the frozen evidence pack
 * @param output untrusted provider output
 * @param pack immutable source material supplied to this run
 * @returns validated output or a model-output failure
 */
export function validateGeneratedAnalysis(
  output: unknown,
  pack: AnalysisEvidencePack,
): OperationResult<AnalysisOutput> {
  const parsed = analysisOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: 'MODEL_OUTPUT_INVALID',
        message: 'The model response did not match the output contract.',
        retryable: false,
      },
      cause: parsed.error,
    };
  }
  const suppliedEvidence = new Set(
    pack.images
      .filter((image) => image.bytes.byteLength > 0)
      .map((image) => image.evidenceId),
  );
  const suppliedObservations = new Set(
    pack.text.flatMap((item) => (item.kind === 'observation' ? [item.id] : [])),
  );
  const sourceIds = new Set(
    pack.text
      .filter((item) => item.kind === 'source')
      .filter((item) => item.contentAsRetrieved.trim())
      .map((item) => item.citationId),
  );
  const rejected = validateAnalysisReferences(parsed.data, {
    evidenceIds: new Set(
      pack.input.evidenceIds.filter((id) => suppliedEvidence.has(id)),
    ),
    observationIds: new Set(
      pack.input.observationIds.filter((id) => suppliedObservations.has(id)),
    ),
    citationIds: new Set(
      pack.citations
        .filter(
          (citation) =>
            citation.availability !== 'unavailable' &&
            citation.verification === 'located' &&
            sourceIds.has(citation.id),
        )
        .map((citation) => citation.id),
    ),
    checkIds: new Set(pack.input.checkIds),
    methodIds: new Set(pack.methods.map((method) => method.methodId)),
  });
  const hasDuplicates = [
    parsed.data.findings.map((item) => item.id),
    parsed.data.nextActions.map((item) => item.id),
    parsed.data.proposedChanges.map((item) => item.id),
  ].some((ids) => new Set(ids).size !== ids.length);
  const hasUnsupportedCertainty = parsed.data.findings.some(
    (finding) =>
      finding.kind === 'hypothesis' &&
      !['tentative', 'undetermined'].includes(finding.certainty),
  );
  const hasIncorrectBeforeValue = parsed.data.proposedChanges.some(
    (change) =>
      !isDeepStrictEqual(change.before, pack.recordFields[change.field]),
  );
  if (
    rejected.length > 0 ||
    hasDuplicates ||
    hasUnsupportedCertainty ||
    hasIncorrectBeforeValue
  ) {
    return {
      success: false,
      error: {
        code: 'MODEL_OUTPUT_INVALID',
        message:
          'The model response contains unsupported or ambiguous evidence references.',
        retryable: false,
      },
    };
  }

  return { success: true, data: parsed.data };
}
