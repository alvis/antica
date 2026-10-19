import { describe, expect, it, vi } from 'vitest';

import { createDevelopmentModels } from '@antica/platform/ai';

import { checkEditingOutput, claimsApplied } from './editing-checks.js';
import { readEditingDataset } from './editing-dataset.js';
import { evaluateEditing } from './editing.js';

import type {
  ModelCatalogPort,
  ModelInvocation,
  RecordEditingPort,
} from '@antica/application/ports';
import type { EditDraftResult } from '@antica/contracts';

import type { EditingChecks } from './editing-checks.js';
import type { EditingDataset } from './editing-dataset.js';

const fullDataset = await readEditingDataset('editing-v1');
const dataset = {
  version: fullDataset.version,
  provenance: fullDataset.provenance,
  records: fullDataset.records,
  cases: fullDataset.cases.filter((item) => item.knowledge === undefined),
};
const [bowl] = dataset.records;
const editName = dataset.cases.find((item) => item.id === 'edit-name')!;
const askMark = dataset.cases.find((item) => item.id === 'ask-mark')!;
const single: EditingDataset = { ...dataset, cases: [editName] };

const catalog: ModelCatalogPort = {
  resolve: async () => ({
    success: true,
    data: {
      effectiveModelId: 'gateway:test',
      capabilities: {
        textInput: true,
        imageInput: false,
        audioInput: false,
        structuredOutput: true,
        toolCalling: false,
      },
    },
  }),
};

const invocation = {
  adapterKind: 'live',
} as ModelInvocation;

/**
 * builds a valid live draft for the edit-name case
 * @param overrides draft fields to replace
 * @returns draft result for the bowl record
 */
function nameDraft(overrides: Partial<EditDraftResult> = {}): EditDraftResult {
  return {
    editDraftId: editName.requestKey,
    recordId: bowl!.recordId,
    baseVersions: bowl!.versions,
    sourceTranscriptionIds: [],
    sourceObservationIds: [],
    replyZhHant: '建議把名稱改為「青花纏枝蓮紋碗」，請在卡片確認。',
    suggestedDescriptionZhHant: bowl!.fields.description,
    proposedChanges: [
      {
        id: '52000000-0000-4000-8000-000000000001',
        field: 'name',
        before: '青花碗',
        proposed: '青花纏枝蓮紋碗',
        findingIds: [],
      },
    ],
    ...overrides,
  };
}

/**
 * evaluates one live-shaped model that returns a fixed result
 * @param draft port implementation under test
 * @param evaluated dataset to run
 * @returns editing report
 */
async function evaluateWith(
  draft: RecordEditingPort['draft'],
  evaluated: EditingDataset = single,
) {
  return evaluateEditing({
    dataset: evaluated,
    modelIds: ['gateway:test'],
    profileVersion: 'test-v1',
    runs: 1,
    model: { draft },
    catalog,
  });
}

describe('editing evaluation', () => {
  it('should pass every legacy case for the development adapter while leaving A8 pending', async () => {
    const models = createDevelopmentModels();

    const report = await evaluateEditing({
      dataset,
      modelIds: ['development:evidence-v1'],
      profileVersion: 'test-v1',
      runs: 1,
      model: models.recordEditing,
      catalog: models.catalog,
    });

    expect(report).toMatchObject({
      kind: 'editing',
      datasetVersion: 'editing-v1',
      datasetDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      evaluations: [
        {
          adapterKind: 'development',
          passedCases: dataset.cases.length,
          totalCases: dataset.cases.length,
          assumptionA8: expect.objectContaining({ verdict: 'pending-live' }),
          error: null,
          byKind: { ask: { passed: 4, total: 4 } },
        },
      ],
    });
  });

  it('should support A8 only when a live model passes every case', async () => {
    const report = await evaluateWith(async () => ({
      success: true,
      data: { value: nameDraft(), invocation },
    }));

    expect(report.evaluations[0]).toMatchObject({
      passedCases: 1,
      assumptionA8: expect.objectContaining({ verdict: 'supported' }),
    });
  });

  it('should reject A8 when a live reply claims the change was applied', async () => {
    const report = await evaluateWith(async () => ({
      success: true,
      data: {
        value: nameDraft({ replyZhHant: '已將名稱改為「青花纏枝蓮紋碗」。' }),
        invocation,
      },
    }));

    expect(report.evaluations[0]).toMatchObject({
      passedCases: 0,
      assumptionA8: expect.objectContaining({ verdict: 'not-supported' }),
      cases: [{ passed: false, checks: { noAppliedClaim: false } }],
    });
  });

  it('should check retained invalid output from a failed live call', async () => {
    const rawOutput = nameDraft({
      proposedChanges: [
        {
          id: '52000000-0000-4000-8000-000000000001',
          field: 'name',
          before: '碗',
          proposed: '青花纏枝蓮紋碗',
          findingIds: [],
        },
      ],
    });

    const report = await evaluateWith(async () => ({
      success: false,
      audit: { invocation, rawOutput },
      error: {
        code: 'MODEL_OUTPUT_INVALID',
        message: 'Invalid',
        retryable: false,
      },
    }));

    expect(report.evaluations[0]).toMatchObject({
      assumptionA8: expect.objectContaining({ verdict: 'not-supported' }),
      cases: [
        {
          passed: false,
          checks: { beforeMatchesRecord: false },
          error: { code: 'MODEL_OUTPUT_INVALID' },
        },
      ],
    });
  });

  it('should leave A8 inconclusive when the provider returns no output', async () => {
    const report = await evaluateWith(async () => ({
      success: false,
      audit: { invocation: null, rawOutput: null },
      error: {
        code: 'PROVIDER_UNAVAILABLE',
        message: 'No key',
        retryable: false,
      },
    }));

    expect(report.evaluations[0]).toMatchObject({
      adapterKind: null,
      assumptionA8: expect.objectContaining({ verdict: 'inconclusive' }),
      cases: [{ passed: false, checks: null, output: null }],
    });
  });

  it('should leave A8 inconclusive when a call throws after another case produced output', async () => {
    const draft = vi
      .fn<RecordEditingPort['draft']>()
      .mockResolvedValueOnce({
        success: true,
        data: { value: nameDraft(), invocation },
      })
      .mockRejectedValueOnce(new TypeError('Network down'));

    const report = await evaluateWith(draft, {
      ...dataset,
      cases: [editName, askMark],
    });

    expect(report.evaluations[0]).toMatchObject({
      adapterKind: 'live',
      assumptionA8: expect.objectContaining({ verdict: 'inconclusive' }),
      byKind: { edit: { passed: 1, total: 1 }, ask: { passed: 0, total: 1 } },
      cases: [
        { passed: true },
        { error: { name: 'TypeError', message: 'Network down' } },
      ],
    });
  });

  it('should record an unresolved model without running any case', async () => {
    const report = await evaluateEditing({
      dataset: single,
      modelIds: ['missing:model'],
      profileVersion: 'test-v1',
      runs: 1,
      model: { draft: vi.fn() },
      catalog: createDevelopmentModels().catalog,
    });

    expect(report.evaluations[0]).toMatchObject({
      totalCases: 0,
      assumptionA8: expect.objectContaining({ verdict: 'inconclusive' }),
      error: { code: 'MODEL_UNKNOWN' },
    });
  });
});

describe('editing output checks', () => {
  it('should report schema issues for output that is not a reply-bearing draft', () => {
    const { replyZhHant: _omitted, ...withoutReply } = nameDraft();

    expect(checkEditingOutput(withoutReply, bowl!, editName)).toMatchObject({
      schemaValid: false,
      replyNonEmpty: null,
      schemaIssues: [expect.stringContaining('replyZhHant')],
    });
  });

  it.for([
    ['identityPreserved', { recordId: '50000000-0000-4000-8000-000000000009' }],
    ['identityPreserved', { sourceObservationIds: [bowl!.recordId] }],
    ['identityPreserved', { sourceTranscriptionIds: [bowl!.recordId] }],
    ['replyNonEmpty', { replyZhHant: '  ' }],
    ['replyWithinLimit', { replyZhHant: `名稱${'答'.repeat(4000)}` }],
    ['expectedFieldsPresent', { proposedChanges: [] }],
    ['replyMentionsProposals', { replyZhHant: '請在卡片確認。' }],
  ] satisfies Array<[keyof EditingChecks, Partial<EditDraftResult>]>)(
    'should fail %s for a violating draft',
    ([check, overrides]) => {
      expect(
        checkEditingOutput(nameDraft(overrides), bowl!, editName)[check],
      ).toBe(false);
    },
  );

  it('should reject unexpected and duplicated proposal fields', () => {
    const [change] = nameDraft().proposedChanges;
    const description = {
      id: '52000000-0000-4000-8000-000000000002',
      field: 'description' as const,
      before: bowl!.fields.description,
      proposed: '改寫',
      findingIds: [],
    };

    expect(
      checkEditingOutput(
        nameDraft({ proposedChanges: [change!, description] }),
        bowl!,
        editName,
      ).noUnexpectedFields,
    ).toBe(false);
    expect(
      checkEditingOutput(
        nameDraft({ proposedChanges: [change!, change!] }),
        bowl!,
        editName,
      ).noUnexpectedFields,
    ).toBe(false);
  });
});

describe('applied-claim detection', () => {
  it.for([
    '已修改名稱。',
    '我已經幫你更新描述。',
    '已為您修改名稱。',
    '已幫您將名稱改為青花纏枝蓮紋碗。',
    '名稱已改為青花纏枝蓮紋碗。',
    '名稱已改成青花纏枝蓮紋碗。',
    '年代已設為清代晚期。',
    '已調整描述。',
    '已新增標籤。',
    '已加入描述。',
    '已移除標籤。',
    '已記錄。',
    '描述已更新。',
    '已成功修改名稱。',
    '名稱修改完成。',
    '名稱改好了。',
    '名稱改好囉！',
    '我把名稱改成了青花纏枝蓮紋碗。',
    '名稱現在是青花纏枝蓮紋碗。',
    '「已套用」',
    '好的，「已套用」',
    '「已套用，未閉合的引號不算引用',
  ])('should flag %s', (reply) => {
    expect(claimsApplied(reply)).toBe(true);
  });

  it.for([
    '目前尚未修改任何欄位。',
    '我不會直接修改名稱。',
    '你確認後才會修改。',
    '請確認是否修改名稱。',
    '目前已記錄的年代是明代。',
    '建議把名稱改為「青花纏枝蓮紋碗」，請確認是否套用。',
    '開發示範：已建議修改「名稱」，請在卡片確認是否套用。',
  ])('should accept %s', (reply) => {
    expect(claimsApplied(reply)).toBe(false);
  });

  it('should ignore a claim phrase only when it quotes a record or proposed value', () => {
    const reply = '建議把名稱改為「已更新版」，請確認。';

    expect(claimsApplied(reply, ['已更新版'])).toBe(false);
    expect(claimsApplied(reply)).toBe(true);
  });
});

describe('reply wording checks', () => {
  const restricted = dataset.cases.find(
    (item) => item.id === 'restricted-location',
  )!;
  const noChange = nameDraft({ proposedChanges: [] });

  it.for([
    ['an English gloss', '建議修改名稱 / Suggested name change。', false],
    ['a quoted proposed value', '建議名稱改為「青花纏枝蓮紋碗」。', true],
  ] as const)('should check %s for Latin runs', ([, reply, expected]) => {
    expect(
      checkEditingOutput(nameDraft({ replyZhHant: reply }), bowl!, editName)
        .noEnglishGloss,
    ).toBe(expected);
  });

  it('should ignore Latin text that repeats a record value', () => {
    const record = {
      ...bowl!,
      fields: { ...bowl!.fields, name: 'Ming bowl' },
    };
    const draft = nameDraft({
      replyZhHant: '建議把名稱 Ming bowl 改為「青花纏枝蓮紋碗」。',
      proposedChanges: [
        {
          id: '52000000-0000-4000-8000-000000000003',
          field: 'name',
          before: 'Ming bowl',
          proposed: '青花纏枝蓮紋碗',
          findingIds: [],
        },
      ],
    });

    expect(checkEditingOutput(draft, record, editName).noEnglishGloss).toBe(
      true,
    );
  });

  it.for([
    ['a refusal', '收藏地點無法透過訊息修改。', true],
    ['no refusal', '好的。', false],
  ] as const)(
    'should require a refusal keyword for a restricted field given %s',
    ([, reply, expected]) => {
      expect(
        checkEditingOutput(
          {
            ...noChange,
            editDraftId: restricted.requestKey,
            replyZhHant: reply,
          },
          bowl!,
          restricted,
        ).refusalStated,
      ).toBe(expected);
    },
  );

  it('should not apply the refusal check to other kinds', () => {
    expect(
      checkEditingOutput(nameDraft(), bowl!, editName).refusalStated,
    ).toBeNull();
  });
});

describe('repeated runs', () => {
  it('should list a case that fails in any run and report the run count', async () => {
    const draft = vi
      .fn<RecordEditingPort['draft']>()
      .mockResolvedValueOnce({
        success: true,
        data: { value: nameDraft(), invocation },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { value: nameDraft({ replyZhHant: '名稱已更新。' }), invocation },
      });

    const report = await evaluateEditing({
      dataset: single,
      modelIds: ['gateway:test'],
      profileVersion: 'test-v1',
      runs: 2,
      model: { draft },
      catalog,
    });

    expect(report.runsPerCase).toBe(2);
    expect(report.evaluations[0]).toMatchObject({
      passedCases: 0,
      totalCases: 1,
      passedRuns: 1,
      totalRuns: 2,
      assumptionA8: {
        verdict: 'not-supported',
        runsPerCase: 2,
        failingCaseIds: ['edit-name'],
      },
      cases: [
        { run: 1, passed: true },
        { run: 2, passed: false },
      ],
    });
  });
});
