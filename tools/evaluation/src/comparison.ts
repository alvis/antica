import { performance } from 'node:perf_hooks';

import {
  analysisOutputSchema,
  validateAnalysisOutput,
  validateAnalysisReferences,
} from '@antica/contracts';

import { createEvidencePack } from './dataset.js';
import { digestSnapshot } from './digest.js';

import type {
  AnalysisEvidencePack,
  AnalysisModelPort,
  ModelCatalogPort,
  ModelInvocation,
  ModelOperationResult,
} from '@antica/application/ports';
import type { AnalysisOutput } from '@antica/contracts';

import type { EvaluationSnapshot } from './dataset.js';
import type { EvaluationReviews, HumanReview } from './review.js';

/** records mechanical validation without claiming semantic factual correctness */
export interface OutputChecks {
  readonly schemaValid: boolean;
  readonly citationsValid: boolean | null;
  readonly rejectedReferenceIds: readonly string[];
  readonly schemaIssues: readonly string[];
}

/** describes the fixed input and registered model capabilities used for comparison */
export interface InferenceComparisonParams {
  readonly snapshot: EvaluationSnapshot;
  readonly modelIds: readonly string[];
  readonly profileVersion: string;
  readonly model: AnalysisModelPort;
  readonly catalog: ModelCatalogPort;
  readonly reviews?: EvaluationReviews;
}

/** preserves a single model result or error with independently timed execution */
export interface InferenceEvaluation {
  readonly requestedModelId: string;
  readonly elapsedMs: number;
  readonly output: unknown;
  readonly outputDigest: string | null;
  readonly invocation: ModelInvocation | null;
  readonly checks: OutputChecks | null;
  readonly error: unknown;
  readonly humanReview: HumanReview;
}

/** describes a replayable inference report */
export interface InferenceReport {
  readonly kind: 'inference';
  readonly snapshotDigest: string;
  readonly snapshot: EvaluationSnapshot;
  readonly profileVersion: string;
  readonly evaluations: readonly InferenceEvaluation[];
  readonly limitations: readonly string[];
}

const pendingReview: HumanReview = {
  reviewer: 'unassigned',
  notes: '',
  unsupportedClaims: 'pending',
  uncertaintyHandling: 'pending',
  sourceDisagreement: 'pending',
  traditionalChinese: 'pending',
  nextActionUsefulness: 'pending',
};

/**
 * compares registered models sequentially against independently decoded identical input
 * @param params fixed snapshot and injected registered model capabilities
 * @returns replayable results, including failed and incompatible models
 * @throws {RangeError} when review annotations refer to another snapshot or model selection
 */
export async function compareInference(
  params: InferenceComparisonParams,
): Promise<InferenceReport> {
  const snapshotDigest = digestSnapshot(params.snapshot);
  if (
    params.reviews &&
    (params.reviews.snapshotDigest !== snapshotDigest ||
      Object.keys(params.reviews.reviews).some(
        (id) => !params.modelIds.includes(id),
      ))
  ) {
    throw new RangeError(
      'Review annotations do not match this snapshot and model selection',
    );
  }
  const evaluations: InferenceEvaluation[] = [];
  for (const requestedModelId of params.modelIds) {
    evaluations.push(await evaluateModel(params, requestedModelId));
  }

  return {
    kind: 'inference',
    snapshotDigest,
    snapshot: params.snapshot,
    profileVersion: params.profileVersion,
    evaluations,
    limitations: [
      'Mechanical citation checks establish allowed identifiers and required references, not semantic claim support.',
      'Human annotations are supplied explicitly and remain pending by default; no authenticity or answer-quality score is inferred.',
      'Development adapters are deterministic fixtures; their unknown token usage is preserved as null.',
    ],
  };
}

/**
 * preserves one independent model invocation including resolution failures
 * @param params shared evaluation inputs
 * @param requestedModelId explicitly selected model
 * @returns timed result with provider diagnostics
 */
async function evaluateModel(
  params: InferenceComparisonParams,
  requestedModelId: string,
): Promise<InferenceEvaluation> {
  const review = params.reviews?.reviews[requestedModelId];
  const humanReview = pendingReview;
  const pack = createEvidencePack(structuredClone(params.snapshot));
  const selection = {
    role: 'analysis' as const,
    modelId: requestedModelId,
    profileVersion: params.profileVersion,
  };
  const start = performance.now();
  try {
    const resolved = await params.catalog.resolve(selection, {
      textInput: true,
      imageInput: pack.images.length > 0,
      structuredOutput: true,
    });
    if (!resolved.success) {
      return {
        requestedModelId,
        elapsedMs: performance.now() - start,
        output: null,
        outputDigest: null,
        invocation: null,
        checks: null,
        error: resolved.error,
        humanReview,
      };
    }
    const result = await params.model.analyze(pack, selection);

    return {
      requestedModelId,
      elapsedMs: performance.now() - start,
      ...captureResult(result, pack, review),
    };
  } catch (exception) {
    const error = exception as Error;

    return {
      requestedModelId,
      elapsedMs: performance.now() - start,
      output: null,
      outputDigest: null,
      invocation: null,
      checks: null,
      error: { name: error.name, message: error.message },
      humanReview,
    };
  }
}

/**
 * binds annotations to the exact generated output while retaining failure audits
 * @param result provider success or failure
 * @param pack allowed reference set
 * @param review optional human review for a specific output
 * @returns output validation and review evidence
 */
function captureResult(
  result: ModelOperationResult<AnalysisOutput>,
  pack: AnalysisEvidencePack,
  review: EvaluationReviews['reviews'][string] | undefined,
): Omit<InferenceEvaluation, 'requestedModelId' | 'elapsedMs'> {
  const output = result.success ? result.data.value : result.audit.rawOutput;
  const outputDigest = output === null ? null : digestSnapshot(output);
  if (!result.success) {
    return {
      output,
      outputDigest,
      invocation: result.audit.invocation,
      checks: null,
      error: result.error,
      humanReview: pendingReview,
    };
  }
  const reviewMatches = review?.outputDigest === outputDigest;

  return {
    output,
    outputDigest,
    invocation: result.data.invocation,
    checks: checkOutput(output, pack),
    error:
      review && !reviewMatches
        ? {
            code: 'REVIEW_OUTPUT_MISMATCH',
            message: 'Human review belongs to a different output digest',
          }
        : null,
    humanReview: reviewMatches ? review.annotations : pendingReview,
  };
}

/**
 * applies production validators to potentially invalid provider output
 * @param output provider output or seeded invalid case
 * @param pack exact allowed evidence and source set
 * @returns mechanical schema and reference verdicts
 */
export function checkOutput(
  output: unknown,
  pack: AnalysisEvidencePack,
): OutputChecks {
  const parsed = analysisOutputSchema.safeParse(output);
  if (!parsed.success) {
    return {
      schemaValid: false,
      citationsValid: null,
      rejectedReferenceIds: [],
      schemaIssues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  const allowed = {
    evidenceIds: new Set(
      pack.images
        .filter((image) => pack.input.evidenceIds.includes(image.evidenceId))
        .map((image) => image.evidenceId),
    ),
    observationIds: new Set(
      pack.text
        .flatMap((item) => (item.kind === 'observation' ? [item.id] : []))
        .filter((id) => pack.input.observationIds.includes(id)),
    ),
    citationIds: new Set(
      pack.citations
        .filter(
          (citation) =>
            citation.verification === 'located' &&
            citation.availability !== 'unavailable',
        )
        .map((citation) => citation.id),
    ),
    checkIds: new Set(pack.input.checkIds),
    methodIds: new Set(pack.methods.map((method) => method.methodId)),
  };
  const validated = validateAnalysisOutput(output, allowed);
  const rejectedReferenceIds = validateAnalysisReferences(parsed.data, allowed);

  return {
    schemaValid: true,
    citationsValid: validated.valid,
    rejectedReferenceIds,
    schemaIssues: [],
  };
}
