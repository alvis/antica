import { performance } from 'node:perf_hooks';

import { digestSnapshot } from './digest.js';
import { checkEditingOutput } from './editing-checks.js';

import type {
  ModelCatalogPort,
  ModelInvocation,
  ModelOperationResult,
  RecordEditingPort,
} from '@antica/application/ports';
import type { EditDraftResult } from '@antica/contracts';

import type { EditingChecks } from './editing-checks.js';
import type {
  EditingCase,
  EditingCaseKind,
  EditingDataset,
  EditingRecord,
} from './editing-dataset.js';

/** preserves one case result, its raw output and its automatic checks */
export interface EditingCaseResult {
  readonly caseId: string;
  /** one-based repetition of this case for the model */
  readonly run: number;
  readonly kind: EditingCaseKind;
  readonly elapsedMs: number;
  readonly output: unknown;
  readonly invocation: ModelInvocation | null;
  readonly checks: EditingChecks | null;
  readonly passed: boolean;
  readonly error: unknown;
}

/** states what one model's run says about assumption A8 */
export type AssumptionVerdict =
  'supported' | 'not-supported' | 'inconclusive' | 'pending-live';

/** states the A8 verdict with the evidence it rests on */
export interface AssumptionResult {
  readonly verdict: AssumptionVerdict;
  readonly runsPerCase: number;
  readonly failingCaseIds: readonly string[];
}

/** summarizes one model across every editing case; a case passes only when every run passes */
export interface EditingModelEvaluation {
  readonly requestedModelId: string;
  readonly adapterKind: ModelInvocation['adapterKind'] | null;
  readonly passedCases: number;
  readonly totalCases: number;
  readonly passedRuns: number;
  readonly totalRuns: number;
  /** passing and total runs per case kind */
  readonly byKind: Readonly<
    Partial<Record<EditingCaseKind, { passed: number; total: number }>>
  >;
  readonly assumptionA8: AssumptionResult;
  readonly error: unknown;
  readonly cases: readonly EditingCaseResult[];
}

/** describes a replayable editing report */
export interface EditingReport {
  readonly kind: 'editing';
  readonly datasetVersion: string;
  readonly datasetDigest: string;
  readonly profileVersion: string;
  readonly runsPerCase: number;
  readonly evaluations: readonly EditingModelEvaluation[];
  readonly limitations: readonly string[];
}

/** describes the fixed dataset and registered editing capability under comparison */
export interface EditingComparisonParams {
  readonly dataset: EditingDataset;
  readonly modelIds: readonly string[];
  readonly profileVersion: string;
  /** repetitions of every case per model */
  readonly runs: number;
  readonly model: RecordEditingPort;
  readonly catalog: ModelCatalogPort;
}

/**
 * compares registered models sequentially on every editing case
 * @param params fixed dataset and injected registered editing capability
 * @returns replayable results, including failed and incompatible models
 */
export async function evaluateEditing(
  params: EditingComparisonParams,
): Promise<EditingReport> {
  const evaluations: EditingModelEvaluation[] = [];
  for (const requestedModelId of params.modelIds) {
    evaluations.push(await evaluateModel(params, requestedModelId));
  }

  return {
    kind: 'editing',
    datasetVersion: params.dataset.version,
    datasetDigest: digestSnapshot(params.dataset),
    profileVersion: params.profileVersion,
    runsPerCase: params.runs,
    evaluations,
    limitations: [
      'Automatic checks verify structure, frozen identity, allowlisted fields, exact before values, field mentions and forbidden applied-claim phrases; they do not verify that an answer is correct or grounded.',
      'Development adapters are deterministic keyword templates; they exercise the harness and cannot settle assumption A8.',
      `Each case ran ${params.runs} time(s) per model; use at least 3 live runs before treating A8 as supported.`,
      'Answers to questions and refusals for non-allowlisted fields require human review.',
    ],
  };
}

/**
 * runs every case against one model after checking that it is registered
 * @param params shared evaluation inputs
 * @param requestedModelId explicitly selected model
 * @returns per-case results and the model's A8 verdict
 */
async function evaluateModel(
  params: EditingComparisonParams,
  requestedModelId: string,
): Promise<EditingModelEvaluation> {
  const selection = {
    role: 'recordEditing' as const,
    modelId: requestedModelId,
    profileVersion: params.profileVersion,
  };
  const resolved = await params.catalog.resolve(selection, {
    textInput: true,
    structuredOutput: true,
  });
  if (!resolved.success) {
    return summarize({
      requestedModelId,
      cases: [],
      error: resolved.error,
      runs: params.runs,
    });
  }
  const records = new Map(
    params.dataset.records.map((record) => [record.key, record]),
  );
  const cases: EditingCaseResult[] = [];
  for (let run = 1; run <= params.runs; run++) {
    for (const item of params.dataset.cases) {
      // the dataset schema guarantees every case refers to a known record
      const record = records.get(item.record)!;
      cases.push({
        ...(await evaluateCase({
          model: params.model,
          selection,
          record,
          item,
        })),
        run,
      });
    }
  }

  return summarize({ requestedModelId, cases, error: null, runs: params.runs });
}

/**
 * sends one collector message with an independent copy of its frozen record
 * @param params editing capability, requested model, frozen record and case
 * @param params.model editing capability under evaluation
 * @param params.selection requested editing model
 * @param params.record synthetic record the message refers to
 * @param params.item collector message and expectations
 * @returns timed case result with checks over success or retained failure output
 */
async function evaluateCase(params: {
  readonly model: RecordEditingPort;
  readonly selection: Parameters<RecordEditingPort['draft']>[3];
  readonly record: EditingRecord;
  readonly item: EditingCase;
}): Promise<Omit<EditingCaseResult, 'run'>> {
  const { model, selection, record, item } = params;
  const start = performance.now();
  try {
    const result: ModelOperationResult<EditDraftResult> = await model.draft(
      {
        requestKey: item.requestKey,
        recordId: record.recordId,
        expectedRecordRevision: record.versions.recordRevision,
        transcriptionIds: [],
        observationIds: [],
        instructionZhHant: item.messageZhHant,
      },
      [],
      {
        fields: structuredClone(record.fields),
        versions: structuredClone(record.versions),
      },
      selection,
    );
    const output = result.success ? result.data.value : result.audit.rawOutput;
    const checks =
      output === null ? null : checkEditingOutput(output, record, item);

    return {
      caseId: item.id,
      kind: item.kind,
      elapsedMs: performance.now() - start,
      output,
      invocation: result.success
        ? result.data.invocation
        : result.audit.invocation,
      checks,
      passed:
        result.success &&
        checks !== null &&
        Object.values(checks).every((value) => value !== false),
      error: result.success ? null : result.error,
    };
  } catch (exception) {
    const error = exception as Error;

    return {
      caseId: item.id,
      kind: item.kind,
      elapsedMs: performance.now() - start,
      output: null,
      invocation: null,
      checks: null,
      passed: false,
      error: { name: error.name, message: error.message },
    };
  }
}

/**
 * counts passing cases and runs and derives what this run says about assumption A8
 * @param params model identity, evaluated runs, resolution failure and run count
 * @param params.requestedModelId explicitly selected model
 * @param params.cases evaluated runs, empty when the model was not resolved
 * @param params.error model resolution failure, if any
 * @param params.runs repetitions of every case
 * @returns model summary with its A8 verdict
 */
function summarize(params: {
  readonly requestedModelId: string;
  readonly cases: readonly EditingCaseResult[];
  readonly error: unknown;
  readonly runs: number;
}): EditingModelEvaluation {
  const { requestedModelId, cases, error, runs } = params;
  const byKind: Partial<
    Record<EditingCaseKind, { passed: number; total: number }>
  > = {};
  for (const item of cases) {
    const tally = byKind[item.kind] ?? { passed: 0, total: 0 };
    byKind[item.kind] = {
      passed: tally.passed + (item.passed ? 1 : 0),
      total: tally.total + 1,
    };
  }
  const adapterKind =
    cases.find((item) => item.invocation !== null)?.invocation?.adapterKind ??
    null;
  const caseIds = [...new Set(cases.map((item) => item.caseId))];
  const failingCaseIds = [
    ...new Set(cases.filter((item) => !item.passed).map((item) => item.caseId)),
  ];

  return {
    requestedModelId,
    adapterKind,
    passedCases: caseIds.length - failingCaseIds.length,
    totalCases: caseIds.length,
    passedRuns: cases.filter((item) => item.passed).length,
    totalRuns: cases.length,
    byKind,
    assumptionA8: {
      verdict: decideAssumption(cases, adapterKind, error),
      runsPerCase: runs,
      failingCaseIds,
    },
    error,
    cases,
  };
}

/**
 * maps one model run to an A8 verdict without treating missing evidence as failure
 * @param cases evaluated cases
 * @param adapterKind adapter that produced the outputs
 * @param error model resolution failure, if any
 * @returns supported only when a live model passes every case
 */
function decideAssumption(
  cases: readonly EditingCaseResult[],
  adapterKind: ModelInvocation['adapterKind'] | null,
  error: unknown,
): AssumptionVerdict {
  if (
    error !== null ||
    adapterKind === null ||
    cases.some((item) => item.output === null)
  ) {
    return 'inconclusive';
  }
  if (adapterKind === 'development') {
    return 'pending-live';
  }

  return cases.every((item) => item.passed) ? 'supported' : 'not-supported';
}
