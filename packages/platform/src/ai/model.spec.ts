import { describe, expect, it } from 'vitest';

import { createDevelopmentModels } from './model.js';

import type { AnalysisEvidencePack } from '@antica/application/ports';
import type { ModelSelection } from '@antica/contracts';
import type { SourceCitation } from '@antica/domain';

const selection: ModelSelection = {
  role: 'analysis',
  modelId: 'development:evidence-v1',
  profileVersion: 'test-v1',
};
const emptyPack: AnalysisEvidencePack = {
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
    recordRevision: 3,
    analysisInputVersion: 2,
    evidenceVersion: 1,
    assetIds: [],
    evidenceIds: [],
    observationIds: [],
    checkIds: [],
    retrievalSnapshotId: '00000000-0000-4000-8000-000000000003',
    promptVersion: 'prompt-v1',
    schemaVersion: 'analysis-v1',
  },
  text: [],
  images: [],
  citations: [],
  methods: [],
};
const researchCitation: SourceCitation = {
  id: '00000000-0000-4000-8000-000000000041',
  relation: 'supports',
  availability: 'stored',
  verification: 'located',
  locator: {
    kind: 'web',
    sourceId: '00000000-0000-4000-8000-000000000042',
    sourceVersionId: '00000000-0000-4000-8000-000000000043',
    url: 'https://example.org/source',
    retrievedAt: '2026-10-13T00:00:00.000Z',
    snapshotAssetId: null,
    blockId: null,
    excerptAsRetrieved: 'Source text',
  },
};

describe('fn:createDevelopmentModels', () => {
  it('should reject an analysis call whose selection belongs to another role', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.analysis.analyze(emptyPack, {
      ...selection,
      role: 'research',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_CAPABILITY_MISMATCH', retryable: false },
      audit: { invocation: null, rawOutput: null },
    });
  });

  it('should expose the selected development model capabilities through the catalog', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.catalog.resolve(selection, {
      imageInput: true,
      structuredOutput: true,
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        effectiveModelId: selection.modelId,
        capabilities: { imageInput: true, structuredOutput: true },
      },
    });
  });

  it('should reject a catalog request for an unregistered development model', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.catalog.resolve(
      { ...selection, modelId: 'development:missing' },
      { imageInput: true },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_UNKNOWN', retryable: false },
    });
  });

  it('should propose a collector-supplied description without applying it to the record', async () => {
    const adapters = createDevelopmentModels();
    const request = {
      requestKey: '00000000-0000-4000-8000-000000000030',
      recordId: emptyPack.input.recordId,
      expectedRecordRevision: 3,
      transcriptionIds: [],
      observationIds: ['00000000-0000-4000-8000-000000000031'],
      instructionZhHant: '整理描述',
    };
    const context = {
      fields: emptyPack.recordFields,
      versions: {
        recordRevision: 3,
        analysisInputVersion: 2,
        evidenceVersion: 1,
      },
    };

    const result = await adapters.recordEditing.draft(
      request,
      ['收藏家原文'],
      context,
      { ...selection, role: 'recordEditing' },
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          editDraftId: request.requestKey,
          recordId: request.recordId,
          sourceObservationIds: request.observationIds,
          proposedChanges: [
            {
              field: 'description',
              before: '',
              proposed: '收藏家原文',
              findingIds: [],
            },
          ],
        },
        invocation: { adapterKind: 'development', role: 'recordEditing' },
      },
    });
    expect(context.fields.description).toBe('');
  });

  it('should leave research claims empty when no located source text was supplied', async () => {
    const adapters = createDevelopmentModels();
    const request = {
      requestKey: '00000000-0000-4000-8000-000000000040',
      instructionZhHant: '研究器物',
      scope: 'curated_only' as const,
      recordId: null,
      entryId: null,
      sourceIds: [],
      preferNamedAuthors: true,
    };

    const result = await adapters.research.draft(
      request,
      { citations: [], text: [] },
      { ...selection, role: 'research' },
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        value: { paragraphs: [], citations: [] },
        invocation: { adapterKind: 'development', role: 'research' },
      },
    });
  });

  it('should quote only located research text and retain its source locator', async () => {
    const adapters = createDevelopmentModels();
    const unavailable = {
      ...researchCitation,
      id: '00000000-0000-4000-8000-000000000044',
      availability: 'unavailable' as const,
    };
    const request = {
      requestKey: '00000000-0000-4000-8000-000000000045',
      instructionZhHant: '研究器物',
      scope: 'curated_only' as const,
      recordId: null,
      entryId: null,
      sourceIds: [],
      preferNamedAuthors: true,
    };

    const result = await adapters.research.draft(
      request,
      {
        citations: [researchCitation, unavailable],
        text: [
          {
            citationId: researchCitation.id,
            contentAsRetrieved: 'Source text',
            sourceRegionId: null,
          },
          {
            citationId: unavailable.id,
            contentAsRetrieved: 'Unverified text',
            sourceRegionId: null,
          },
        ],
      },
      { ...selection, role: 'research' },
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          citations: [researchCitation],
          paragraphs: [
            {
              textZhHant: 'Source text',
              citationIds: [researchCitation.id],
              support: 'cited',
            },
          ],
        },
      },
    });
  });

  it('should reject a generated observation that was not selected into the frozen input', async () => {
    const adapters = createDevelopmentModels();
    const unselectedId = '00000000-0000-4000-8000-000000000046';
    const inconsistentPack: AnalysisEvidencePack = {
      ...emptyPack,
      text: [
        {
          kind: 'check',
          id: '00000000-0000-4000-8000-000000000047',
          content: 'Inspected',
        },
        { kind: 'observation', id: unselectedId, content: 'Unselected note' },
      ],
    };

    const result = await adapters.analysis.analyze(inconsistentPack, selection);

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_OUTPUT_INVALID' },
      audit: {
        invocation: { citationCheck: { valid: false } },
        rawOutput: { findings: [{ observationIds: [unselectedId] }] },
      },
    });
  });

  it('should turn a located source excerpt into a cited source statement', async () => {
    const adapters = createDevelopmentModels();
    const sourcedPack: AnalysisEvidencePack = {
      ...emptyPack,
      text: [
        {
          kind: 'source',
          citationId: researchCitation.id,
          contentAsRetrieved: 'Source text',
          sourceRegionId: null,
        },
      ],
      citations: [researchCitation],
    };

    const result = await adapters.analysis.analyze(sourcedPack, selection);

    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          findings: [
            {
              kind: 'sourceStatement',
              text: 'Source text',
              citationIds: [researchCitation.id],
              evidenceIds: [],
            },
          ],
          proposedChanges: [],
        },
      },
    });
  });

  it('should omit source statements without a located citation and retrieved text', async () => {
    const adapters = createDevelopmentModels();
    const missingId = '00000000-0000-4000-8000-000000000048';
    const unavailableId = '00000000-0000-4000-8000-000000000049';
    const unlocatedId = '00000000-0000-4000-8000-000000000050';
    const invalidSources: AnalysisEvidencePack = {
      ...emptyPack,
      text: [
        {
          kind: 'source',
          citationId: missingId,
          contentAsRetrieved: 'Missing',
          sourceRegionId: null,
        },
        {
          kind: 'source',
          citationId: unavailableId,
          contentAsRetrieved: 'Unavailable',
          sourceRegionId: null,
        },
        {
          kind: 'source',
          citationId: unlocatedId,
          contentAsRetrieved: 'Unlocated',
          sourceRegionId: null,
        },
        {
          kind: 'source',
          citationId: researchCitation.id,
          contentAsRetrieved: '  ',
          sourceRegionId: null,
        },
      ],
      citations: [
        { ...researchCitation, id: unavailableId, availability: 'unavailable' },
        { ...researchCitation, id: unlocatedId, verification: 'needs_review' },
        researchCitation,
      ],
    };

    const result = await adapters.analysis.analyze(invalidSources, selection);

    expect(result).toMatchObject({
      success: true,
      data: { value: { findings: [], proposedChanges: [] } },
    });
  });

  it('should reject role mismatches at each non-analysis development port', async () => {
    const adapters = createDevelopmentModels();
    const requestKey = '00000000-0000-4000-8000-000000000051';
    const research = await adapters.research.draft(
      {
        requestKey,
        instructionZhHant: '研究器物',
        scope: 'curated_only',
        recordId: null,
        entryId: null,
        sourceIds: [],
        preferNamedAuthors: true,
      },
      { citations: [], text: [] },
      selection,
    );
    const editing = await adapters.recordEditing.draft(
      {
        requestKey,
        recordId: emptyPack.input.recordId,
        expectedRecordRevision: 3,
        transcriptionIds: [],
        observationIds: [],
        instructionZhHant: '整理描述',
      },
      ['Collector text'],
      {
        fields: emptyPack.recordFields,
        versions: {
          recordRevision: 3,
          analysisInputVersion: 2,
          evidenceVersion: 1,
        },
      },
      selection,
    );
    const transcription = await adapters.transcription.transcribe(
      {
        requestKey,
        recordId: emptyPack.input.recordId,
        audioAssetId: requestKey,
        vocabularyHints: [],
      },
      { mimeType: 'audio/wav', bytes: new Uint8Array([1]) },
      selection,
    );

    for (const result of [research, editing, transcription]) {
      expect(result).toMatchObject({
        success: false,
        error: { code: 'MODEL_CAPABILITY_MISMATCH', retryable: false },
        audit: { invocation: null, rawOutput: null },
      });
    }
  });

  it('should avoid proposing a description that matches the frozen record', async () => {
    const adapters = createDevelopmentModels();
    const currentDescription = 'Already recorded';

    const result = await adapters.recordEditing.draft(
      {
        requestKey: '00000000-0000-4000-8000-000000000052',
        recordId: emptyPack.input.recordId,
        expectedRecordRevision: 3,
        transcriptionIds: [],
        observationIds: [],
        instructionZhHant: '整理描述',
      },
      [currentDescription],
      {
        fields: { ...emptyPack.recordFields, description: currentDescription },
        versions: {
          recordRevision: 3,
          analysisInputVersion: 2,
          evidenceVersion: 1,
        },
      },
      { ...selection, role: 'recordEditing' },
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          proposedChanges: [],
          suggestedDescriptionZhHant: currentDescription,
        },
      },
    });
  });

  it('should reject an unknown analysis model without generating any output', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.analysis.analyze(emptyPack, {
      ...selection,
      modelId: 'development:missing',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'MODEL_UNKNOWN', retryable: false },
      audit: { invocation: null, rawOutput: null },
    });
  });

  it('should label development output and preserve missing evidence as uncertainty', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.analysis.analyze(emptyPack, selection);

    expect(result).toMatchObject({
      success: true,
      data: {
        invocation: {
          requestedModelId: selection.modelId,
          effectiveModelId: selection.modelId,
          adapterKind: 'development',
        },
        value: { findings: [], proposedChanges: [] },
      },
    });
    if (!result.success) {
      throw new Error('Expected successful development analysis');
    }
    expect(result.data.value.uncertainties.length).toBeGreaterThan(0);
  });

  it('should retain collector observations as reported input without relabeling touch as visual evidence', async () => {
    const adapters = createDevelopmentModels();
    const pack: AnalysisEvidencePack = {
      ...emptyPack,
      input: {
        ...emptyPack.input,
        observationIds: ['00000000-0000-4000-8000-000000000004'],
      },
      text: [
        {
          kind: 'observation',
          id: '00000000-0000-4000-8000-000000000004',
          content: '摸落去有啲粗糙，唔肯定係咪修補。',
        },
      ],
    };

    const result = await adapters.analysis.analyze(pack, selection);

    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          findings: expect.arrayContaining([
            expect.objectContaining({
              kind: 'collectorObservation',
              observationIds: ['00000000-0000-4000-8000-000000000004'],
              evidenceIds: [],
            }),
          ]),
        },
      },
    });
    if (!result.success) {
      throw new Error('Expected successful development analysis');
    }
    expect(
      result.data.value.findings.some(
        (finding) => finding.kind === 'visualObservation',
      ),
    ).toBe(false);
  });

  it('should preserve the explicitly requested compatible development model in audit metadata', async () => {
    const adapters = createDevelopmentModels();
    const secondSelection = {
      ...selection,
      modelId: 'development:evidence-v2',
    };

    const result = await adapters.analysis.analyze(emptyPack, secondSelection);

    expect(result).toMatchObject({
      success: true,
      data: {
        invocation: {
          requestedModelId: secondSelection.modelId,
          effectiveModelId: secondSelection.modelId,
          promptVersion: emptyPack.input.promptVersion,
          schemaVersion: emptyPack.input.schemaVersion,
        },
      },
    });
  });

  it('should return an explicit unavailable result for unconfigured transcription without creating a transcript', async () => {
    const adapters = createDevelopmentModels();

    const result = await adapters.transcription.transcribe(
      {
        requestKey: 'voice-command',
        recordId: 'pair',
        audioAssetId: 'voice-1',
        vocabularyHints: [],
      },
      { mimeType: 'audio/wav', bytes: new Uint8Array([82, 73, 70, 70]) },
      {
        role: 'transcription',
        modelId: 'development:transcription',
        profileVersion: 'test-v1',
      },
    );

    expect(result).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });
});
