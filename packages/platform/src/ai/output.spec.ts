import { describe, expect, it } from 'vitest';

import { validateGeneratedAnalysis } from './output.js';

import type { AnalysisEvidencePack } from '@antica/application/ports';
import type { AnalysisOutput, Finding } from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

const citationId = '00000000-0000-4000-8000-000000000010';
const evidenceId = '00000000-0000-4000-8000-000000000011';
const finding: Finding = {
  id: '00000000-0000-4000-8000-000000000012',
  kind: 'sourceStatement',
  text: '來源記載此工藝仍需比對。',
  evidenceIds: [],
  observationIds: [],
  citationIds: [citationId],
  relation: 'supports',
  certainty: 'reported',
};
const citation: SourceCitation = {
  id: citationId,
  relation: 'supports',
  availability: 'stored',
  verification: 'located',
  locator: {
    kind: 'web',
    sourceId: '00000000-0000-4000-8000-000000000013',
    sourceVersionId: '00000000-0000-4000-8000-000000000014',
    url: 'https://example.org/book',
    retrievedAt: '2026-10-13T00:00:00.000Z',
    snapshotAssetId: null,
    blockId: null,
    excerptAsRetrieved: 'Original source text.',
  },
};
const pack: AnalysisEvidencePack = {
  recordFields: {
    name: null,
    unitKind: 'set',
    components: [],
    pieceCount: null,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: '',
    collectorJudgment: null,
  },
  input: {
    recordId: '00000000-0000-4000-8000-000000000001',
    snapshotId: '00000000-0000-4000-8000-000000000002',
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    assetIds: ['00000000-0000-4000-8000-000000000015'],
    evidenceIds: [evidenceId],
    observationIds: [],
    checkIds: [],
    retrievalSnapshotId: '00000000-0000-4000-8000-000000000003',
    promptVersion: 'v1',
    schemaVersion: 'v1',
  },
  text: [
    {
      kind: 'source',
      citationId,
      contentAsRetrieved: 'Original source text.',
      sourceRegionId: null,
    },
  ],
  images: [
    {
      evidenceId,
      mediaType: 'image/png',
      bytes: new Uint8Array([137, 80, 78, 71]),
    },
  ],
  citations: [citation],
  methods: [],
};
const output: AnalysisOutput = {
  summary: '尚需實查。',
  findings: [finding],
  uncertainties: ['年代未定'],
  suggestedMethodIds: [],
  nextActions: [],
  proposedChanges: [],
};

describe('fn:validateGeneratedAnalysis', () => {
  it('should accept a located claim backed by actual retrieved source content', () => {
    expect(validateGeneratedAnalysis(output, pack)).toEqual({
      success: true,
      data: output,
    });
  });

  it('should accept a located source claim when collector observations are also supplied', () => {
    const observationId = '00000000-0000-4000-8000-000000000018';
    const mixedPack: AnalysisEvidencePack = {
      ...pack,
      input: { ...pack.input, observationIds: [observationId] },
      text: [
        { kind: 'observation', id: observationId, content: 'Collector note' },
        ...pack.text,
      ],
    };

    expect(validateGeneratedAnalysis(output, mixedPack)).toEqual({
      success: true,
      data: output,
    });
  });

  it('should accept a suggested inspection method only when it was supplied in the frozen pack', () => {
    const methodId = '00000000-0000-4000-8000-000000000019';
    const suggested: AnalysisOutput = {
      ...output,
      suggestedMethodIds: [methodId],
    };
    const withMethod: AnalysisEvidencePack = {
      ...pack,
      methods: [
        {
          methodId,
          methodVersionId: '00000000-0000-4000-8000-000000000020',
          owningEntryId: '00000000-0000-4000-8000-000000000021',
          titleZhHant: '檢查表面',
          definition: {
            titleZhHant: '檢查表面',
            history: [],
            featureEntryIds: [],
            applicability: [],
            observationModes: ['in_person_visual'],
            steps: [],
            interpretationLimits: [],
            exampleReferenceImageIds: [],
            citations: [],
          },
        },
      ],
    };

    expect(validateGeneratedAnalysis(suggested, withMethod)).toEqual({
      success: true,
      data: suggested,
    });
    expect(validateGeneratedAnalysis(suggested, pack)).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject a citation from outside the frozen evidence pack', () => {
    const result = validateGeneratedAnalysis(output, {
      ...pack,
      citations: [],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject a source statement when only locator metadata reached the model', () => {
    const result = validateGeneratedAnalysis(output, { ...pack, text: [] });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject unavailable citations instead of treating their claims as established', () => {
    const result = validateGeneratedAnalysis(output, {
      ...pack,
      citations: [{ ...citation, availability: 'unavailable' }],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject visual claims when the selected image bytes were not supplied', () => {
    const visualOutput: AnalysisOutput = {
      ...output,
      findings: [
        {
          ...finding,
          kind: 'visualObservation',
          citationIds: [],
          evidenceIds: [evidenceId],
        },
      ],
    };

    const result = validateGeneratedAnalysis(visualOutput, {
      ...pack,
      images: [],
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject proposals supported by a finding that the run never produced', () => {
    const result = validateGeneratedAnalysis(
      {
        ...output,
        proposedChanges: [
          {
            id: '00000000-0000-4000-8000-000000000016',
            field: 'description',
            before: '',
            proposed: '未經證實',
            findingIds: ['00000000-0000-4000-8000-000000000099'],
          },
        ],
      },
      pack,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject duplicate action identities that would make later resolution ambiguous', () => {
    const action = {
      id: '00000000-0000-4000-8000-000000000017',
      kind: 'describe',
      instruction: '補充觸感',
      reason: '缺少觀察',
    };

    const result = validateGeneratedAnalysis(
      { ...output, nextActions: [action, action] },
      pack,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject model-supplied write instructions outside the allowed output schema', () => {
    const result = validateGeneratedAnalysis(
      { ...output, tools: [{ name: 'adoptAll', arguments: {} }] },
      pack,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should retain an unsupported possibility only as an explicitly tentative hypothesis', () => {
    const hypothesis: AnalysisOutput = {
      ...output,
      findings: [
        {
          ...finding,
          kind: 'hypothesis',
          certainty: 'tentative',
          citationIds: [],
        },
      ],
    };

    expect(
      validateGeneratedAnalysis(hypothesis, {
        ...pack,
        citations: [],
        text: [],
      }),
    ).toEqual({ success: true, data: hypothesis });
  });

  it('should reject a proposal whose before value disagrees with the frozen record', () => {
    const result = validateGeneratedAnalysis(
      {
        ...output,
        proposedChanges: [
          {
            id: '00000000-0000-4000-8000-000000000016',
            field: 'description',
            before: 'An invented prior description',
            proposed: '整理後描述',
            findingIds: [finding.id],
          },
        ],
      },
      pack,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });

  it('should reject an unsupported hypothesis presented with observed certainty', () => {
    const result = validateGeneratedAnalysis(
      {
        ...output,
        findings: [
          {
            ...finding,
            kind: 'hypothesis',
            certainty: 'observed',
            citationIds: [],
          },
        ],
      },
      pack,
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
    });
  });
});
