import { describe, expect, it } from 'vitest';

import {
  actionResolutionRequestSchema,
  applyAnalysisChangesSchema,
  analysisRunDetailSchema,
  editDraftGenerationSchema,
  editDraftResultSchema,
  isProposalCurrent,
  proposedChangeSchema,
  validateAnalysisOutput,
  validateAnalysisReferences,
} from './analysis.js';

import type {
  AnalysisOutput,
  AnalysisReferenceSet,
  ProposedChange,
} from './analysis.js';

const id = '00000000-0000-4000-8000-000000000001';
const output: AnalysisOutput = {
  summary: '尚未確定',
  findings: [
    {
      id,
      kind: 'hypothesis',
      text: '待查',
      evidenceIds: [id],
      observationIds: [id],
      citationIds: [id],
      relation: 'context',
      certainty: 'tentative',
    },
  ],
  uncertainties: [],
  suggestedMethodIds: [id],
  nextActions: [
    {
      id,
      checkId: id,
      kind: 'confirmFeature',
      instruction: 'Inspect',
      reason: 'Unknown',
    },
  ],
  proposedChanges: [
    {
      id,
      field: 'description',
      before: '',
      proposed: 'Tentative',
      findingIds: [id],
    },
  ],
};
const allowed: AnalysisReferenceSet = {
  evidenceIds: new Set([id]),
  observationIds: new Set([id]),
  citationIds: new Set([id]),
  checkIds: new Set([id]),
  methodIds: new Set([id]),
};

describe('fn:validateAnalysisReferences', () => {
  it('should accept references that belong to the frozen evidence and method sets', () => {
    expect(validateAnalysisReferences(output, allowed)).toEqual([]);
  });

  it.each([
    'evidenceIds',
    'observationIds',
    'citationIds',
    'checkIds',
    'methodIds',
  ] as const)('should reject an unavailable %s reference', (key) => {
    expect(
      validateAnalysisReferences(output, {
        ...allowed,
        [key]: new Set<string>(),
      }),
    ).toContain(id);
  });

  it('should reject a proposal supported by a finding absent from the output', () => {
    expect(
      validateAnalysisReferences({ ...output, findings: [] }, allowed),
    ).toEqual([id]);
  });

  it.each([
    { kind: 'sourceStatement', citationIds: [] },
    { kind: 'visualObservation', evidenceIds: [] },
    { kind: 'collectorObservation', observationIds: [] },
  ] satisfies ReadonlyArray<Partial<AnalysisOutput['findings'][number]>>)(
    'should reject an unsupported %s finding',
    (change) => {
      const finding = { ...output.findings[0]!, ...change };

      expect(
        validateAnalysisReferences({ ...output, findings: [finding] }, allowed),
      ).toContain(id);
    },
  );

  it('should accept an action without a check reference', () => {
    const action = { ...output.nextActions[0]!, checkId: undefined };

    expect(
      validateAnalysisReferences({ ...output, nextActions: [action] }, allowed),
    ).toEqual([]);
  });
});

describe('fn:validateAnalysisOutput', () => {
  it('should return the parsed output when its references are available', () => {
    expect(validateAnalysisOutput(output, allowed)).toEqual({
      valid: true,
      output,
    });
  });

  it('should reject malformed output and unavailable frozen references', () => {
    expect(validateAnalysisOutput({}, allowed)).toMatchObject({ valid: false });
    expect(
      validateAnalysisOutput(output, {
        ...allowed,
        evidenceIds: new Set<string>(),
      }),
    ).toMatchObject({ valid: false });
  });
});

describe('analysis change adoption validation', () => {
  it('should reject a proposal selected and skipped in the same adoption', () => {
    const request = { expectedRecordRevision: 1, selectedProposalIds: [id] };

    expect(applyAnalysisChangesSchema.safeParse(request).success).toBe(true);
    expect(
      applyAnalysisChangesSchema.safeParse({
        ...request,
        skippedProposalIds: [id],
      }).success,
    ).toBe(false);
    expect(
      applyAnalysisChangesSchema.safeParse({
        ...request,
        skippedProposalIds: [],
      }).success,
    ).toBe(true);
  });
});

describe('analysis run detail validation', () => {
  const run = {
    runId: id,
    recordId: id,
    jobId: id,
    status: 'completed',
    snapshot: {
      id,
      recordRevision: 1,
      analysisInputVersion: 1,
      evidenceVersion: 1,
      assetIds: [],
      evidenceIds: [],
      observationIds: [],
      checkIds: [],
      retrievalSnapshotId: null,
    },
    citations: [],
    suggestedMethods: [],
    invocation: {
      requestedModelId: 'research-model',
      effectiveModelId: 'research-model',
      provider: 'development',
      providerModelVersion: null,
      adapterKind: 'development',
      capabilities: {
        textInput: true,
        imageInput: false,
        audioInput: false,
        structuredOutput: true,
        toolCalling: false,
      },
      role: 'analysis',
      profileVersion: 'v1',
      promptVersion: 'v1',
      schemaVersion: 'v1',
      effectiveOptions: {},
      latencyMs: 0,
      usage: { inputTokens: null, outputTokens: null },
      finishReason: null,
      citationCheck: { valid: true, rejectedReferenceIds: [] },
    },
    failureAudits: [],
    result: { output: null, actionStates: [], proposalStates: [] },
  };

  it('should accept an analysis run with a recorded model invocation', () => {
    expect(analysisRunDetailSchema.safeParse(run).success).toBe(true);
  });

  it('should retain failed generated output in audit history without treating it as a valid result', () => {
    const rawOutput = { summary: 7, findings: [{ text: 'Unverified glaze' }] };
    const failed = {
      ...run,
      status: 'failed',
      invocation: null,
      failureAudits: [
        { invocation: run.invocation, rawOutput },
        { invocation: null, rawOutput: { summary: 'Incomplete draft' } },
      ],
    };
    const parsed = analysisRunDetailSchema.parse(
      JSON.parse(JSON.stringify(failed)),
    );

    expect(parsed.result.output).toBeNull();
    expect(parsed.failureAudits).toEqual(failed.failureAudits);
    expect(
      analysisRunDetailSchema.safeParse({
        ...failed,
        result: {
          ...failed.result,
          output: rawOutput,
        },
      }).success,
    ).toBe(false);
  });
});

describe('analysis action resolution validation', () => {
  it.each([
    undefined,
    {},
    { observationIds: [] },
    { onSiteDescription: '   ' },
  ])(
    'should reject supplied action resolution without actual supporting content: %j',
    (support) => {
      expect(
        actionResolutionRequestSchema.safeParse({
          expectedActionRevision: 1,
          expectedRecordRevision: 1,
          status: 'supplied',
          support,
        }).success,
      ).toBe(false);
    },
  );

  it.each([
    { observationIds: [id] },
    { evidenceAnchorIds: [id] },
    { referenceLinkIds: [id] },
    { checkIds: [id] },
    { onSiteDescription: '摸落去粗糙' },
  ])('should accept an explicit supporting item: %j', (support) => {
    expect(
      actionResolutionRequestSchema.safeParse({
        expectedActionRevision: 1,
        expectedRecordRevision: 1,
        status: 'supplied',
        support,
      }).success,
    ).toBe(true);
  });
});

describe('edit draft result validation', () => {
  const result = {
    editDraftId: id,
    recordId: id,
    baseVersions: {
      recordRevision: 1,
      analysisInputVersion: 1,
      evidenceVersion: 1,
    },
    sourceTranscriptionIds: [],
    sourceObservationIds: [],
    suggestedDescriptionZhHant: '手感粗糙',
    proposedChanges: [],
  };

  it('should keep the assistant reply of a new result', () => {
    expect(
      editDraftResultSchema.parse({ ...result, replyZhHant: '已整理描述' })
        .replyZhHant,
    ).toBe('已整理描述');
  });

  it('should read a result stored before replies existed as an empty reply', () => {
    expect(editDraftResultSchema.parse(result).replyZhHant).toBe('');
  });

  it('should keep parsing a reply longer than the stored cap so the handler can truncate it', () => {
    const long = '答'.repeat(5000);

    expect(
      editDraftResultSchema.parse({ ...result, replyZhHant: long }).replyZhHant,
    ).toBe(long);
  });

  it('should reject a reply that is not text', () => {
    expect(
      editDraftResultSchema.safeParse({ ...result, replyZhHant: 1 }).success,
    ).toBe(false);
  });
  it('should require a model-generated draft to include its reply', () => {
    expect(editDraftGenerationSchema.safeParse(result).success).toBe(false);
    expect(
      editDraftGenerationSchema.parse({ ...result, replyZhHant: '好的' })
        .replyZhHant,
    ).toBe('好的');
    expect(
      editDraftGenerationSchema.safeParse({
        ...result,
        replyZhHant: '好的',
        extra: true,
      }).success,
    ).toBe(false);
  });
});

const proposalId = '00000000-0000-4000-8000-000000000009';
const diameter = { value: 21.8, unit: 'cm' } as const;
const height = { value: 4.2, unit: 'cm' } as const;

const currentFields = {
  name: null,
  description: '',
  collectorJudgment: null,
  materialIds: [],
  categoryIds: [],
  period: null,
  tags: [],
  dimensions: {},
};

describe('proposal text validation', () => {
  it.each(['condition', 'surface'] as const)(
    'should require both values for %s',
    (field) => {
      const proposal = {
        id: proposalId,
        findingIds: [],
        field,
        before: null,
        proposed: 'Observed',
      };

      expect(proposedChangeSchema.safeParse(proposal).success).toBe(true);
      expect(
        proposedChangeSchema.safeParse({ ...proposal, before: undefined })
          .success,
      ).toBe(false);
      expect(
        proposedChangeSchema.safeParse({ ...proposal, proposed: undefined })
          .success,
      ).toBe(false);
      expect(
        proposedChangeSchema.safeParse({ ...proposal, proposed: null }).success,
      ).toBe(true);
    },
  );
});

describe('fn:isProposalCurrent', () => {
  it.each(['condition', 'surface'] as const)(
    'should treat missing and null %s as the same unset value',
    (field) => {
      const change = {
        id: proposalId,
        findingIds: [],
        field,
        before: null,
        proposed: 'Observed',
      } satisfies ProposedChange;

      expect(isProposalCurrent(currentFields, change)).toBe(true);
      expect(
        isProposalCurrent({ ...currentFields, [field]: null }, change),
      ).toBe(true);
      expect(
        isProposalCurrent(
          { ...currentFields, [field]: 'Collector edit' },
          change,
        ),
      ).toBe(false);
      expect(
        isProposalCurrent(currentFields, { ...change, before: 'Earlier' }),
      ).toBe(false);
    },
  );

  it('should treat equal dimensions as current whatever order their keys were written in', () => {
    const change: ProposedChange = {
      id: proposalId,
      findingIds: [],
      field: 'dimensions',
      before: { diameter, height },
      proposed: { diameter: { value: 21.5, unit: 'cm' } },
    };

    expect(
      isProposalCurrent(
        {
          ...currentFields,
          dimensions: { height, diameter, weight: undefined },
        },
        change,
      ),
    ).toBe(true);
  });

  it('should treat a proposal as stale once its field moved since it was made', () => {
    const change: ProposedChange = {
      id: proposalId,
      findingIds: [],
      field: 'dimensions',
      before: {},
      proposed: { diameter: { value: 21.5, unit: 'cm' } },
    };

    expect(
      isProposalCurrent({ ...currentFields, dimensions: { diameter } }, change),
    ).toBe(false);
  });
});
