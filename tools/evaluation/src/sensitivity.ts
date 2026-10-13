import { resolveModel } from '@antica/platform/ai';
import {
  developmentTextIndex,
  validateIndexSpace,
} from '@antica/platform/search';

import { checkOutput } from './comparison.js';
import { createEvidencePack, readSnapshot } from './dataset.js';

import type { AnalysisOutput } from '@antica/contracts';
import type { ModelProfile } from '@antica/platform/ai';

/** records observed acceptance against a seed's known mechanical expectation */
export interface SensitivityCase {
  readonly id: string;
  readonly expectedAccepted: boolean;
  readonly accepted: boolean;
}

/** records measured false passes and the intentionally exposed semantic limit */
export interface SensitivityReport {
  readonly kind: 'sensitivity';
  readonly cases: readonly SensitivityCase[];
  readonly invalidCaseCount: number;
  readonly falsePassCount: number;
  readonly falsePassRate: number;
  readonly falseRejectCount: number;
  readonly semanticProbe: {
    readonly accepted: boolean;
    readonly semanticVerdict: 'not-adjudicated';
    readonly limitation: string;
  };
  readonly passed: boolean;
}

const valid: AnalysisOutput = {
  summary: '無法判定',
  findings: [],
  uncertainties: ['需要補充照片與來源'],
  suggestedMethodIds: [],
  nextActions: [],
  proposedChanges: [],
};
const sourceFinding = {
  id: '20000000-0000-4000-8000-000000000001',
  kind: 'sourceStatement',
  text: '來源說法',
  evidenceIds: [],
  observationIds: [],
  citationIds: ['20000000-0000-4000-8000-000000000004'],
  relation: 'context',
  certainty: 'reported',
};
const seeds = [
  { id: 'valid-uncertainty-control', output: valid, expectedAccepted: true },
  {
    id: 'extra-price-field',
    output: { ...valid, priceEstimate: 100 },
    expectedAccepted: false,
  },
  {
    id: 'malformed-findings',
    output: { ...valid, findings: 'wrong shape' },
    expectedAccepted: false,
  },
  {
    id: 'foreign-citation',
    output: { ...valid, findings: [sourceFinding] },
    expectedAccepted: false,
  },
  {
    id: 'missing-source-citation',
    output: { ...valid, findings: [{ ...sourceFinding, citationIds: [] }] },
    expectedAccepted: false,
  },
  {
    id: 'unsupported-visual-assertion',
    output: {
      ...valid,
      findings: [
        {
          ...sourceFinding,
          kind: 'visualObservation',
          certainty: 'observed',
          citationIds: [],
        },
      ],
    },
    expectedAccepted: false,
  },
  {
    id: 'foreign-evidence',
    output: {
      ...valid,
      findings: [
        {
          ...sourceFinding,
          kind: 'visualObservation',
          citationIds: [],
          evidenceIds: ['20000000-0000-4000-8000-000000000003'],
        },
      ],
    },
    expectedAccepted: false,
  },
];

/**
 * exercises production validators with valid controls and seeded malformed outputs
 * @returns false-pass measurements for these seeds only, plus a semantic blind spot
 */
export async function measureSensitivity(): Promise<SensitivityReport> {
  const pack = createEvidencePack(await readSnapshot('synthetic-evidence-v1'));
  const emptyPack = createEvidencePack(
    await readSnapshot('synthetic-no-evidence-v1'),
  );
  const outputCases = seeds.map((seed) => {
    const checks = checkOutput(seed.output, emptyPack);

    return {
      id: seed.id,
      expectedAccepted: seed.expectedAccepted,
      accepted: checks.schemaValid && checks.citationsValid === true,
    };
  });
  const cases = [...outputCases, ...measureCapabilitySeeds()];
  const semanticChecks = checkOutput(
    {
      ...valid,
      findings: [
        {
          ...sourceFinding,
          kind: 'visualObservation',
          certainty: 'observed',
          text: '此器物保證為真品。',
          citationIds: [],
          evidenceIds: ['10000000-0000-4000-8000-000000000007'],
        },
      ],
    },
    pack,
  );
  const invalidCaseCount = cases.filter(
    (entry) => !entry.expectedAccepted,
  ).length;
  const falsePassCount = cases.filter(
    (entry) => !entry.expectedAccepted && entry.accepted,
  ).length;
  const falseRejectCount = cases.filter(
    (entry) => entry.expectedAccepted && !entry.accepted,
  ).length;

  return {
    kind: 'sensitivity',
    cases,
    invalidCaseCount,
    falsePassCount,
    falsePassRate: falsePassCount / invalidCaseCount,
    falseRejectCount,
    semanticProbe: {
      accepted:
        semanticChecks.schemaValid && semanticChecks.citationsValid === true,
      semanticVerdict: 'not-adjudicated',
      limitation:
        'A false authenticity claim with an allowed evidence ID can pass structural validation. Human claim-support review is mandatory; seed results do not establish general false-pass rates.',
    },
    passed: falsePassCount === 0 && falseRejectCount === 0,
  };
}

/**
 * probes model capabilities and incompatible retrieval identities independently
 * @returns observed capability and index rejection cases
 */
function measureCapabilitySeeds(): SensitivityCase[] {
  const textOnly: ModelProfile = {
    modelId: 'seed:text-only',
    provider: 'seed',
    providerModelVersion: null,
    adapterKind: 'development',
    roles: ['analysis'],
    capabilities: {
      textInput: true,
      imageInput: false,
      audioInput: false,
      structuredOutput: true,
      toolCalling: false,
    },
  };
  const selection = {
    role: 'analysis' as const,
    modelId: textOnly.modelId,
    profileVersion: 'seed-v1',
  };

  return [
    {
      id: 'incompatible-image-model',
      expectedAccepted: false,
      accepted: resolveModel([textOnly], selection, { imageInput: true }).ok,
    },
    {
      id: 'unknown-model',
      expectedAccepted: false,
      accepted: resolveModel([], selection, { imageInput: true }).ok,
    },
    ...[
      {
        ...developmentTextIndex,
        embeddingModelId: '20000000-0000-4000-8000-000000000003',
      },
      { ...developmentTextIndex, dimensions: 2 },
      {
        ...developmentTextIndex,
        indexVersion: '20000000-0000-4000-8000-000000000003',
      },
    ].map((index, position) => ({
      id: `incompatible-index-${position + 1}`,
      expectedAccepted: false,
      accepted: validateIndexSpace(developmentTextIndex, index).valid,
    })),
  ];
}
