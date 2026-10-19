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
          replyZhHant: '開發示範：已依你提供的文字整理描述，請確認是否套用。',
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
          replyZhHant: '開發示範：描述沒有需要修改的地方。',
          proposedChanges: [],
          suggestedDescriptionZhHant: currentDescription,
        },
      },
    });
  });

  it.for([
    ['a typed message', '請把描述改成青瓷', '請把描述改成青瓷'],
    ['an empty instruction', '', ''],
  ])(
    'should use the instruction as the description when %s has no source text',
    async ([, instruction, expected]) => {
      const adapters = createDevelopmentModels();

      const result = await adapters.recordEditing.draft(
        {
          requestKey: '00000000-0000-4000-8000-000000000053',
          recordId: emptyPack.input.recordId,
          expectedRecordRevision: 3,
          transcriptionIds: [],
          observationIds: [],
          instructionZhHant: instruction!,
        },
        [],
        {
          fields: emptyPack.recordFields,
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
            suggestedDescriptionZhHant: expected,
            proposedChanges: expected
              ? [{ field: 'description', proposed: expected }]
              : [],
            replyZhHant: expected
              ? '開發示範：已依你提供的文字整理描述，請確認是否套用。'
              : '開發示範：描述沒有需要修改的地方。',
          },
        },
      });
    },
  );

  describe('when the collector message is a question or a targeted edit', () => {
    const versions = {
      recordRevision: 3,
      analysisInputVersion: 2,
      evidenceVersion: 1,
    };
    const fields = {
      ...emptyPack.recordFields,
      name: '青花碗',
      description: '青花瓷碗',
      period: { label: '明代', status: 'collectorClaim' as const },
    };

    /**
     * drafts one development edit for a typed or transcribed message
     * @param instruction typed collector message
     * @param sourceText transcribed source text
     * @returns development draft result
     */
    async function draftMessage(
      instruction: string,
      sourceText: readonly string[] = [],
    ) {
      return createDevelopmentModels().recordEditing.draft(
        {
          requestKey: '00000000-0000-4000-8000-000000000054',
          recordId: emptyPack.input.recordId,
          expectedRecordRevision: 3,
          transcriptionIds: [],
          observationIds: [],
          instructionZhHant: instruction,
        },
        sourceText,
        { fields, versions },
        { ...selection, role: 'recordEditing' },
      );
    }

    it.for([
      ['a full-width question mark', '描述有提到款識嗎？', []],
      ['an ASCII question mark', 'Is there a mark?', []],
      ['a transcribed question', '', ['這件是什麼年代？']],
    ] as const)(
      'should reply without proposals for %s',
      async ([, instruction, sourceText]) => {
        const result = await draftMessage(instruction, sourceText);

        expect(result).toMatchObject({
          success: true,
          data: {
            value: {
              replyZhHant:
                '開發示範：這是提問；開發模型不會回答內容，也沒有建議任何修改。',
              suggestedDescriptionZhHant: '青花瓷碗',
              proposedChanges: [],
            },
            invocation: {
              promptVersion: 'editing-v3',
              schemaVersion: 'editing-v3',
            },
          },
        });
      },
    );

    it('should refuse a field outside the editing allowlist', async () => {
      const result = await draftMessage('請把收藏地點改成「二樓書房」');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant:
              '開發示範：這個欄位無法透過訊息修改，沒有建議任何修改。',
            proposedChanges: [],
          },
        },
      });
    });

    it('should propose a quoted name and name the waiting card', async () => {
      const result = await draftMessage('請把名稱改成「青花纏枝蓮紋碗」');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：已建議修改「名稱」，請在卡片確認是否套用。',
            suggestedDescriptionZhHant: '青花瓷碗',
            proposedChanges: [
              {
                field: 'name',
                before: '青花碗',
                proposed: '青花纏枝蓮紋碗',
                findingIds: [],
              },
            ],
          },
        },
      });
    });

    it('should propose a quoted period as a collector claim', async () => {
      const result = await draftMessage('請把年代改成「清代晚期」');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：已建議修改「年代」，請在卡片確認是否套用。',
            proposedChanges: [
              {
                field: 'period',
                before: fields.period,
                proposed: { label: '清代晚期', status: 'collectorClaim' },
              },
            ],
          },
        },
      });
    });

    it.for([
      ['an empty quotation', '請把名稱改成「 」'],
      ['an unclosed quotation', '請把名稱改成「青花'],
    ])(
      'should fall back to a description proposal for %s',
      async ([, instruction]) => {
        const result = await draftMessage(instruction!);

        expect(result).toMatchObject({
          success: true,
          data: {
            value: {
              proposedChanges: [
                { field: 'description', proposed: instruction },
              ],
            },
          },
        });
      },
    );

    it('should target the field named closest before the quoted value', async () => {
      const result = await draftMessage('把年代改成「清代」，名稱不變');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            proposedChanges: [
              {
                field: 'period',
                proposed: { label: '清代', status: 'collectorClaim' },
              },
            ],
          },
        },
      });
    });

    it('should keep raw-description behaviour when no field precedes the quote', async () => {
      const result = await draftMessage('「青花」兩字要寫進名稱');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            proposedChanges: [
              { field: 'description', proposed: '「青花」兩字要寫進名稱' },
            ],
          },
        },
      });
    });

    it('should propose the allowlisted change and refuse the restricted one', async () => {
      const result = await draftMessage(
        '請把名稱改成「青花纏枝蓮紋碗」，收藏地點也改成二樓',
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant:
              '開發示範：已建議修改「名稱」，請在卡片確認是否套用。另外，這個欄位無法透過訊息修改。',
            proposedChanges: [{ field: 'name', proposed: '青花纏枝蓮紋碗' }],
          },
        },
      });
    });

    it('should propose nothing when the quoted name is already current', async () => {
      const result = await draftMessage('名稱就是「青花碗」');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：名稱沒有需要修改的地方。',
            proposedChanges: [],
          },
        },
      });
    });

    it('should propose every labelled quoted value and name each card', async () => {
      const result = await draftMessage(
        '請把名稱改成「青花纏枝蓮紋碗」，年代改成「清代晚期」',
      );
      const nameOnly = await draftMessage('請把名稱改成「青花纏枝蓮紋碗」');
      const periodOnly = await draftMessage('請把年代改成「清代晚期」');

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant:
              '開發示範：已建議修改「名稱」、「年代」，請在卡片確認是否套用。',
            suggestedDescriptionZhHant: '青花瓷碗',
            proposedChanges: [
              {
                id:
                  nameOnly.success &&
                  nameOnly.data.value.proposedChanges[0]!.id,
                field: 'name',
                before: '青花碗',
                proposed: '青花纏枝蓮紋碗',
                findingIds: [],
              },
              {
                id:
                  periodOnly.success &&
                  periodOnly.data.value.proposedChanges[0]!.id,
                field: 'period',
                before: fields.period,
                proposed: { label: '清代晚期', status: 'collectorClaim' },
                findingIds: [],
              },
            ],
          },
        },
      });
    });

    it('should keep only the first quoted value for a repeated field', async () => {
      const result = await draftMessage(
        '名稱改成「青花纏枝蓮紋碗」，名稱也可以叫「青花大碗」',
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：已建議修改「名稱」，請在卡片確認是否套用。',
            proposedChanges: [{ field: 'name', proposed: '青花纏枝蓮紋碗' }],
          },
        },
      });
      expect(result.success && result.data.value.proposedChanges).toHaveLength(
        1,
      );
    });

    it('should propose only the changed value when another is already current', async () => {
      const result = await draftMessage(
        '名稱就是「青花碗」，年代改成「清代晚期」',
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：已建議修改「年代」，請在卡片確認是否套用。',
            proposedChanges: [
              {
                field: 'period',
                proposed: { label: '清代晚期', status: 'collectorClaim' },
              },
            ],
          },
        },
      });
      expect(result.success && result.data.value.proposedChanges).toHaveLength(
        1,
      );
    });

    it('should name every unchanged field when no quoted value differs', async () => {
      const result = await draftMessage(
        '請把年代改成「明代」，名稱就是「青花碗」',
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：年代、名稱沒有需要修改的地方。',
            proposedChanges: [],
          },
        },
      });
    });

    it('should ignore an unlabelled or empty quote beside a labelled one', async () => {
      const result = await draftMessage(
        '「青花」兩字很重要，「 」，請把名稱改成「青花纏枝蓮紋碗」',
      );

      expect(result).toMatchObject({
        success: true,
        data: {
          value: {
            replyZhHant: '開發示範：已建議修改「名稱」，請在卡片確認是否套用。',
            proposedChanges: [{ field: 'name', proposed: '青花纏枝蓮紋碗' }],
          },
        },
      });
      expect(result.success && result.data.value.proposedChanges).toHaveLength(
        1,
      );
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

describe('fn:createDevelopmentModels grounded editing', () => {
  it('should acknowledge questions without saved knowledge or invented references or edits', async () => {
    const request = {
      requestKey: '00000000-0000-4000-8000-000000000030',
      recordId: emptyPack.input.recordId,
      expectedRecordRevision: 3,
      transcriptionIds: [],
      observationIds: [],
      instructionZhHant: '這件器物有什麼來源支持？',
    };
    const context = {
      fields: emptyPack.recordFields,
      versions: {
        recordRevision: 3,
        analysisInputVersion: 2,
        evidenceVersion: 1,
      },
      knowledgeContext: {
        schemaVersion: 1 as const,
        snapshotId: '00000000-0000-4000-8000-000000000040',
        snapshotHash: 'a'.repeat(64),
        recordId: request.recordId,
        recordRevision: 3,
        corpusGeneration: 'generation-1',
        entries: [],
      },
    };
    const result = await createDevelopmentModels().recordEditing.draft(
      request,
      [],
      context,
      { ...selection, role: 'recordEditing' },
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        value: {
          editDraftId: request.requestKey,
          proposedChanges: [],
          answerSegments: [
            {
              text: expect.stringContaining('開發示範：這是提問'),
              evidenceRefs: [],
            },
          ],
        },
      },
    });
  });
});
