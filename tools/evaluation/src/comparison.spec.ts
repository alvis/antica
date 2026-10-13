import { describe, expect, it } from 'vitest';

import { createDevelopmentModels } from '@antica/platform/ai';

import { checkOutput, compareInference } from './comparison.js';
import { createEvidencePack, readSnapshot } from './dataset.js';

describe('fn:compareInference', () => {
  it('should use the same frozen input for two registered models and preserve failed selection', async () => {
    const models = createDevelopmentModels();
    const snapshot = await readSnapshot('synthetic-evidence-v1');
    const report = await compareInference({
      snapshot,
      modelIds: [
        'development:evidence-v1',
        'development:evidence-v2',
        'unregistered:model',
      ],
      profileVersion: 'evaluation-v1',
      model: models.analysis,
      catalog: models.catalog,
    });

    expect(
      report.evaluations.slice(0, 2).map((evaluation) => evaluation.checks),
    ).toEqual([
      {
        schemaValid: true,
        citationsValid: true,
        rejectedReferenceIds: [],
        schemaIssues: [],
      },
      {
        schemaValid: true,
        citationsValid: true,
        rejectedReferenceIds: [],
        schemaIssues: [],
      },
    ]);
    expect(report.evaluations[2]?.error).toMatchObject({
      code: 'MODEL_UNKNOWN',
    });
    expect(report.evaluations[0]?.invocation).toMatchObject({
      adapterKind: 'development',
      promptVersion: snapshot.input.promptVersion,
      schemaVersion: snapshot.input.schemaVersion,
    });
  });

  it('should preserve provider failures and unexpected exceptions without switching models', async () => {
    const models = createDevelopmentModels();
    const snapshot = await readSnapshot('synthetic-no-evidence-v1');
    const unavailable = await compareInference({
      snapshot,
      modelIds: ['development:evidence-v1', 'development:evidence-v2'],
      profileVersion: 'evaluation-v1',
      catalog: models.catalog,
      model: {
        analyze: async (_pack, selection) => ({
          success: false,
          audit: {
            invocation: null,
            rawOutput:
              selection.modelId === 'development:evidence-v1'
                ? { partial: 'Provider output' }
                : null,
          },
          error: {
            code: 'PROVIDER_UNAVAILABLE',
            message: 'Configured provider unavailable',
            retryable: true,
          },
        }),
      },
    });
    const crashed = await compareInference({
      snapshot,
      modelIds: ['development:evidence-v1'],
      profileVersion: 'evaluation-v1',
      catalog: models.catalog,
      model: {
        analyze: async () => {
          throw new Error('Provider crashed');
        },
      },
    });
    expect(unavailable.evaluations[0]).toMatchObject({
      requestedModelId: 'development:evidence-v1',
      output: { partial: 'Provider output' },
      invocation: null,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(crashed.evaluations[0]).toMatchObject({
      requestedModelId: 'development:evidence-v1',
      output: null,
      invocation: null,
      error: { message: 'Provider crashed' },
    });
  });
});

describe('fn:checkOutput', () => {
  it('should accept supplied collector observations and reject unavailable source citations and methods', async () => {
    const snapshot = await readSnapshot('synthetic-evidence-v1');
    const observationId = '20000000-0000-4000-8000-000000000009';
    const pack = createEvidencePack({
      ...snapshot,
      input: { ...snapshot.input, observationIds: [observationId] },
      text: [
        ...snapshot.text,
        { id: observationId, kind: 'observation', content: '收藏者觀察' },
        { id: observationId, kind: 'check', content: '檢查' },
      ],
    });
    const output = {
      summary: '觀察',
      findings: [
        {
          id: observationId,
          kind: 'collectorObservation',
          text: '收藏者觀察',
          evidenceIds: [],
          observationIds: [observationId],
          citationIds: [],
          relation: 'context',
          certainty: 'reported',
        },
      ],
      uncertainties: [],
      suggestedMethodIds: [],
      nextActions: [],
      proposedChanges: [],
    };
    expect(checkOutput(output, pack)).toMatchObject({
      schemaValid: true,
      citationsValid: true,
    });
    expect(
      checkOutput({ ...output, suggestedMethodIds: [observationId] }, pack),
    ).toMatchObject({ schemaValid: true, citationsValid: false });
    const citation = pack.citations[0]!;
    const sourceOutput = {
      ...output,
      findings: [
        {
          ...output.findings[0],
          kind: 'sourceStatement',
          observationIds: [],
          citationIds: [citation.id],
        },
      ],
    };
    expect(
      checkOutput(sourceOutput, {
        ...pack,
        citations: [{ ...citation, verification: 'located' }],
      }).citationsValid,
    ).toBe(true);
    const method = {
      methodId: observationId,
      methodVersionId: observationId,
      owningEntryId: observationId,
      titleZhHant: '觀察',
      definition: {
        titleZhHant: '觀察',
        history: [],
        featureEntryIds: [],
        applicability: [],
        observationModes: [],
        steps: [],
        interpretationLimits: [],
        exampleReferenceImageIds: [],
        citations: [],
      },
    };
    expect(
      checkOutput(
        { ...output, suggestedMethodIds: [observationId] },
        { ...pack, methods: [method] },
      ).citationsValid,
    ).toBe(true);
    expect(
      checkOutput(sourceOutput, {
        ...pack,
        citations: [{ ...citation, availability: 'unavailable' }],
      }).citationsValid,
    ).toBe(false);
  });

  it('should reject both extra provider instructions and foreign evidence references', async () => {
    const pack = createEvidencePack(
      await readSnapshot('synthetic-no-evidence-v1'),
    );
    const base = {
      summary: '無法判定',
      findings: [],
      uncertainties: ['需要更多資料'],
      suggestedMethodIds: [],
      nextActions: [],
      proposedChanges: [],
    };
    expect(
      checkOutput({ ...base, priceEstimate: 1000 }, pack).schemaValid,
    ).toBe(false);
    expect(
      checkOutput(
        {
          ...base,
          findings: [
            {
              id: '20000000-0000-4000-8000-000000000002',
              kind: 'visualObservation',
              text: '斷言',
              evidenceIds: ['20000000-0000-4000-8000-000000000003'],
              observationIds: [],
              citationIds: [],
              relation: 'supports',
              certainty: 'observed',
            },
          ],
        },
        pack,
      ),
    ).toMatchObject({
      schemaValid: true,
      citationsValid: false,
      rejectedReferenceIds: ['20000000-0000-4000-8000-000000000003'],
    });
  });
});
