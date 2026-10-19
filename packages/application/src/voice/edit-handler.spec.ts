import { describe, expect, it, vi } from 'vitest';

import {
  knowledgeNoSupportedAnswer,
  recordMessageReplyMaxLength,
} from '@antica/contracts';

import { createEditDraftHandler } from './edit-handler.js';

import type {
  EditDraftResult,
  KnowledgeEvidenceSnapshotV1,
  JobEnvelope,
  ModelInvocation,
  RecordFields,
} from '@antica/contracts';

import type {
  EditDraftRunRecord,
  ModelCatalogPort,
  OperationResult,
  RecordEditingPort,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const observationId = '00000000-0000-4000-8000-000000000003';
const draftId = '00000000-0000-4000-8000-000000000004';
const jobId = '00000000-0000-4000-8000-000000000005';
const proposalId = '00000000-0000-4000-8000-000000000006';
const replyId = '00000000-0000-4000-8000-000000000007';
const collectorMessageId = '00000000-0000-4000-8000-000000000008';
const now = '2026-10-13T12:00:00.000Z';
const versions = {
  recordRevision: 1,
  analysisInputVersion: 1,
  evidenceVersion: 1,
};
const fields: RecordFields = {
  name: 'Vase',
  unitKind: 'single',
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
};
const result: EditDraftResult = {
  editDraftId: draftId,
  recordId,
  baseVersions: versions,
  sourceTranscriptionIds: [],
  sourceObservationIds: [observationId],
  replyZhHant: '  我整理了名稱，請確認。  ',
  suggestedDescriptionZhHant: '青瓷瓶',
  proposedChanges: [
    {
      id: proposalId,
      field: 'name',
      before: 'Vase',
      proposed: 'Celadon vase',
      findingIds: [],
    },
  ],
};
const invocation: ModelInvocation = {
  requestedModelId: 'development',
  effectiveModelId: 'development',
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
  role: 'recordEditing',
  profileVersion: '1',
  promptVersion: '1',
  schemaVersion: '1',
  effectiveOptions: {},
  latencyMs: 1,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

function pendingRun(): EditDraftRunRecord {
  return {
    detail: {
      editDraftId: draftId,
      jobId,
      revision: 1,
      status: 'pending',
      snapshot: {
        recordId,
        versions,
        fields,
        transcriptionVersions: [],
        observationIds: [observationId],
        sourceText: [
          { kind: 'observation', id: observationId, text: '青瓷瓶' },
        ],
        createdAt: now,
      },
      result: null,
      invocation: null,
      appliedProposalIds: [],
      skippedProposalIds: [],
      createdAt: now,
      updatedAt: now,
    },
    request: {
      requestKey: draftId,
      recordId,
      expectedRecordRevision: 1,
      transcriptionIds: [],
      observationIds: [observationId],
      instructionZhHant: '整理描述',
    },
    modelSelection: {
      role: 'recordEditing',
      modelId: 'development',
      profileVersion: '1',
    },
  };
}

function job(): JobEnvelope {
  return {
    id: jobId,
    kind: 'recordEditing',
    resourceId: draftId,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: null,
  };
}

function fixture(
  options: {
    readonly run?: EditDraftRunRecord | null;
    readonly job?: JobEnvelope | null;
    readonly output?: EditDraftResult;
    readonly outputs?: readonly EditDraftResult[];
    readonly capabilityFailure?: boolean;
    readonly modelFailure?: boolean;
    readonly modelErrors?: ReadonlyArray<
      'MODEL_OUTPUT_INVALID' | 'PROVIDER_UNAVAILABLE' | null
    >;
    readonly missingAudit?: boolean;
    readonly saveResult?: boolean;
    readonly updateJob?: boolean;
    readonly afterModel?: 'run_missing' | 'job_missing' | 'already_saved';
    /** whether a collector message started the draft */
    readonly linked?: boolean;
  } = {},
) {
  const current = {
    run: 'run' in options ? (options.run ?? null) : pendingRun(),
    job: 'job' in options ? (options.job ?? null) : job(),
  };
  const saveResult = vi.fn(async (_id: string, saved: EditDraftResult) => {
    if (options.saveResult === false) {
      return false;
    }
    if (current.run) {
      current.run = {
        ...current.run,
        detail: {
          ...current.run.detail,
          status: 'ready',
          revision: 2,
          result: saved,
        },
      };
    }

    return true;
  });
  const updateJob = vi.fn(async () => options.updateJob !== false);
  const insertAssistantReply = vi.fn(async () => ({
    created: true,
    message: {
      id: replyId,
      recordId,
      author: 'assistant' as const,
      body: 'stored',
      editDraftId: draftId,
      createdAt: now,
    },
  }));
  const repositories = {
    jobs: { get: vi.fn(async () => current.job), update: updateJob },
    editDrafts: { get: vi.fn(async () => current.run), saveResult },
    recordMessages: {
      findCollectorMessage: vi.fn(async () =>
        options.linked
          ? {
              id: collectorMessageId,
              recordId,
              author: 'collector' as const,
              body: 'Tidy the description',
              editDraftId: draftId,
              createdAt: now,
            }
          : null,
      ),
      insertAssistantReply,
    },
  };
  const unit = new Proxy({} as UnitOfWork, {
    get(_target, key) {
      if (key in repositories) {
        return Reflect.get(repositories, key);
      }
      throw new Error(`Unexpected repository: ${String(key)}`);
    },
  });
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      _owner: string,
      operation: (work: UnitOfWork) => Promise<T>,
    ): Promise<T> => operation(unit),
  };
  const catalog: ModelCatalogPort = {
    resolve: vi.fn(async () =>
      options.capabilityFailure
        ? {
            success: false as const,
            error: {
              code: 'PROVIDER_UNAVAILABLE' as const,
              message: 'Unavailable',
              retryable: true,
            },
          }
        : {
            success: true as const,
            data: {
              effectiveModelId: 'development',
              capabilities: invocation.capabilities,
            },
          },
    ),
  };
  const modelCalls = { count: 0 };
  const draft = vi.fn(async () => {
    const output =
      options.outputs?.[modelCalls.count] ?? options.output ?? result;
    modelCalls.count += 1;
    if (options.afterModel === 'run_missing') {
      current.run = null;
    }
    if (options.afterModel === 'job_missing') {
      current.job = null;
    }
    if (options.afterModel === 'already_saved' && current.run) {
      current.run = {
        ...current.run,
        detail: { ...current.run.detail, result },
      };
    }

    const code = options.modelErrors?.[modelCalls.count - 1];
    if (code) {
      return {
        success: false as const,
        error: { code, message: 'Provider rejected output', retryable: false },
        audit: {
          invocation: options.missingAudit ? null : invocation,
          rawOutput: null,
        },
      };
    }

    return options.modelFailure
      ? {
          success: false as const,
          error: {
            code: 'PROVIDER_UNAVAILABLE' as const,
            message: 'Unavailable',
            retryable: true,
          },
          audit: { invocation: null, rawOutput: null },
        }
      : {
          success: true as const,
          data: { value: output, invocation },
        };
  });
  const model: RecordEditingPort = { draft };
  const handler = createEditDraftHandler(
    transaction,
    model,
    catalog,
    { now: () => now },
    { create: () => replyId },
  );

  return {
    handler,
    current,
    draft,
    saveResult,
    updateJob,
    insertAssistantReply,
  };
}

describe('fn:createEditDraftHandler', () => {
  it('should generate from the frozen source text and save suggestions without adoption', async () => {
    const ports = fixture();
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledWith(
      ports.current.run?.request,
      ['青瓷瓶'],
      { fields, versions },
      ports.current.run?.modelSelection,
    );
    expect(ports.current.run?.detail).toMatchObject({
      status: 'ready',
      result,
      appliedProposalIds: [],
    });
    expect(ports.updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        state: { kind: 'succeeded', completedAt: now },
        result: { editDraftId: draftId },
      }),
      now,
    );
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(1);
  });

  it('should reject missing jobs or drafts and stop on capability or model failure', async () => {
    expect(await fixture({ job: null }).handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await fixture({ job: { ...job(), kind: 'media' } }).handler(
        ownerId,
        jobId,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(await fixture({ run: null }).handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await fixture({ capabilityFailure: true }).handler(ownerId, jobId),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      await fixture({ modelFailure: true }).handler(ownerId, jobId),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
  });

  it('should reject malformed output, changed frozen identities, and duplicate proposals', async () => {
    expect(
      await fixture({ output: { ...result, editDraftId: 'bad-id' } }).handler(
        ownerId,
        jobId,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: { ...result, recordId: '00000000-0000-4000-8000-000000000099' },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: { ...result, sourceObservationIds: [] },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: {
          ...result,
          baseVersions: { ...versions, evidenceVersion: 2 },
        },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: {
          ...result,
          proposedChanges: [
            ...result.proposedChanges,
            ...result.proposedChanges,
          ],
        },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: {
          ...result,
          proposedChanges: [
            {
              id: proposalId,
              field: 'name',
              before: 'Other',
              proposed: 'Celadon vase',
              findingIds: [],
            },
          ],
        },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should detect disappeared jobs and concurrent saved results after generation', async () => {
    expect(
      await fixture({ afterModel: 'run_missing' }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ afterModel: 'job_missing' }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const concurrent = fixture({ afterModel: 'already_saved' });
    expect(await concurrent.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(concurrent.saveResult).not.toHaveBeenCalled();
    expect(concurrent.insertAssistantReply).not.toHaveBeenCalled();
  });

  it('should report draft or job compare-and-swap conflicts', async () => {
    const changedDraft = fixture({ saveResult: false });
    expect(await changedDraft.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(changedDraft.updateJob).not.toHaveBeenCalled();
    expect(changedDraft.insertAssistantReply).not.toHaveBeenCalled();
    const changedJob = fixture({ updateJob: false, linked: true });
    expect(await changedJob.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(changedJob.insertAssistantReply).not.toHaveBeenCalled();
  });

  it('should answer a draft started from a record message with the trimmed model reply', async () => {
    const ports = fixture({ linked: true });

    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.insertAssistantReply).toHaveBeenCalledExactlyOnceWith({
      id: replyId,
      recordId,
      editDraftId: draftId,
      body: '我整理了名稱，請確認。',
      createdAt: now,
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.insertAssistantReply).toHaveBeenCalledTimes(1);
  });

  it.for([
    ['a blank reply', { ...result, replyZhHant: '  \n ' }],
    ['a missing reply', (({ replyZhHant: _reply, ...rest }) => rest)(result)],
  ] as const)(
    'should answer neutrally when the model returns %s',
    async ([, output]) => {
      const ports = fixture({
        linked: true,
        output: output as unknown as EditDraftResult,
      });

      await ports.handler(ownerId, jobId);

      expect(ports.insertAssistantReply).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ body: '已處理你的訊息。' }),
      );
    },
  );

  it('should cut an over-long reply to the cap in the stored result and the message', async () => {
    const long = '答'.repeat(recordMessageReplyMaxLength + 50);
    const ports = fixture({
      linked: true,
      output: { ...result, replyZhHant: long },
    });

    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });

    const capped = '答'.repeat(recordMessageReplyMaxLength);
    expect(ports.current.run?.detail.result?.replyZhHant).toBe(capped);
    expect(ports.insertAssistantReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: capped }),
    );
  });

  it('should not leave half a character at the cut', async () => {
    const long = `答${'\u{1F3FA}'.repeat(recordMessageReplyMaxLength)}`;
    const ports = fixture({
      linked: true,
      output: { ...result, replyZhHant: long },
    });

    await ports.handler(ownerId, jobId);

    const stored = ports.current.run?.detail.result?.replyZhHant ?? '';
    expect(stored).toHaveLength(recordMessageReplyMaxLength - 1);
    expect(stored.isWellFormed()).toBe(true);
  });

  it('should not answer a draft that no record message started', async () => {
    const ports = fixture({ linked: false });

    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.insertAssistantReply).not.toHaveBeenCalled();
  });
});

const evidenceRef = {
  entryId: '00000000-0000-4000-8000-000000000020',
  revision: 1,
  claimKey: 'material',
  citationIds: ['00000000-0000-4000-8000-000000000021'],
};
const knowledgeContext: KnowledgeEvidenceSnapshotV1 = {
  schemaVersion: 1,
  snapshotId: '00000000-0000-4000-8000-000000000030',
  snapshotHash: 'a'.repeat(64),
  recordId,
  recordRevision: 1,
  corpusGeneration: 'generation-1',
  entries: [
    {
      entryId: evidenceRef.entryId,
      revision: 1,
      contentHash: 'b'.repeat(64),
      title: 'Museum vase',
      claims: [
        {
          claimId: '00000000-0000-4000-8000-000000000022',
          claimKey: evidenceRef.claimKey,
          statement: 'This museum vase is porcelain.',
          originalText: 'This museum vase is porcelain.',
          language: 'en',
          scope: { object: ['This vase'] },
          qualifiers: { attribution: 'tentative' },
          uncertainty: 'Not applicable to every vase.',
          sourceVersionIds: ['00000000-0000-4000-8000-000000000023'],
          citations: [
            {
              citationId: evidenceRef.citationIds[0]!,
              sourceId: '00000000-0000-4000-8000-000000000024',
              sourceVersionId: '00000000-0000-4000-8000-000000000023',
              locatorId: '00000000-0000-4000-8000-000000000025',
              relation: 'supports',
              sourceTitle: 'Catalog',
              excerpt: 'This museum vase is porcelain.',
            },
          ],
        },
      ],
    },
  ],
};

function groundedRun(): EditDraftRunRecord {
  const run = pendingRun();

  return {
    ...run,
    detail: {
      ...run.detail,
      snapshot: { ...run.detail.snapshot, knowledgeContext },
    },
  };
}

const supportedResult: EditDraftResult = {
  ...result,
  replyZhHant: 'Unverified separate prose must not be published.',
  proposedChanges: [],
  answerSegments: [
    {
      text: '這件館藏記載為瓷器，不能推論所有瓶。',
      evidenceRefs: [evidenceRef],
    },
  ],
};
const unsupportedReferenceResult: EditDraftResult = {
  ...supportedResult,
  proposedChanges: result.proposedChanges,
  answerSegments: [
    {
      text: 'Unsupported claim.',
      evidenceRefs: [{ ...evidenceRef, revision: 99 }],
    },
  ],
};

describe('fn:createEditDraftHandler grounded replies', () => {
  it('should persist answer-only segments and frozen context without a record edit', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      output: supportedResult,
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledExactlyOnceWith(
      ports.current.run?.request,
      ['青瓷瓶'],
      { fields, versions, knowledgeContext },
      ports.current.run?.modelSelection,
    );
    expect(ports.current.run?.detail.result).toMatchObject({
      editDraftId: draftId,
      proposedChanges: [],
      answerSegments: supportedResult.answerSegments,
      replyZhHant: supportedResult.answerSegments?.[0]?.text,
    });
    expect(ports.insertAssistantReply).toHaveBeenCalledWith(
      expect.objectContaining({
        body: supportedResult.answerSegments?.[0]?.text,
      }),
    );
  });

  it('should repair an invalid reference exactly once using the same frozen evidence', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      outputs: [unsupportedReferenceResult, supportedResult],
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.saveResult).toHaveBeenCalledWith(
      draftId,
      expect.any(Object),
      invocation,
      1,
      now,
    );
    expect(ports.draft).toHaveBeenLastCalledWith(
      ports.current.run?.request,
      ['青瓷瓶'],
      expect.objectContaining({
        knowledgeContext,
        evidenceRepair: expect.any(String),
      }),
      ports.current.run?.modelSelection,
    );
    expect(ports.current.run?.detail.result).toMatchObject({
      answerSegments: supportedResult.answerSegments,
      proposedChanges: [],
    });
    expect(ports.insertAssistantReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        body: supportedResult.answerSegments?.[0]?.text,
      }),
    );
  });

  it('should replace repeatedly invalid evidence with the explicit unsupported answer and no proposals', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      output: unsupportedReferenceResult,
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.saveResult).toHaveBeenCalledWith(
      draftId,
      expect.any(Object),
      {
        ...invocation,
        citationCheck: { valid: false, rejectedReferenceIds: [] },
      },
      1,
      now,
    );
    expect(ports.current.run?.detail.result).toMatchObject({
      replyZhHant: knowledgeNoSupportedAnswer,
      answerSegments: [{ text: knowledgeNoSupportedAnswer, evidenceRefs: [] }],
      proposedChanges: [],
    });
    expect(ports.insertAssistantReply).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ body: knowledgeNoSupportedAnswer }),
    );
  });

  it('should preserve valid edit proposals beside a verified supported answer without applying them', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      output: { ...supportedResult, proposedChanges: result.proposedChanges },
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.current.run?.detail).toMatchObject({
      result: {
        answerSegments: supportedResult.answerSegments,
        proposedChanges: result.proposedChanges,
      },
      appliedProposalIds: [],
    });
  });
});

describe('fn:createEditDraftHandler evidence failures', () => {
  it('should repair malformed model output before storing a verified answer', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      output: supportedResult,
      modelErrors: ['MODEL_OUTPUT_INVALID', null],
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.current.run?.detail.result).toMatchObject({
      answerSegments: supportedResult.answerSegments,
    });
  });

  it('should fall back after a failed repair while retaining the original invocation', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      output: unsupportedReferenceResult,
      modelErrors: [null, 'PROVIDER_UNAVAILABLE'],
      missingAudit: true,
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.current.run?.detail.result).toMatchObject({
      replyZhHant: knowledgeNoSupportedAnswer,
      proposedChanges: [],
    });
    expect(ports.saveResult).toHaveBeenCalledWith(
      draftId,
      expect.any(Object),
      {
        ...invocation,
        citationCheck: { valid: false, rejectedReferenceIds: [] },
      },
      1,
      now,
    );
  });

  it('should fall back after two schema rejections and retain the available audit', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      modelErrors: ['MODEL_OUTPUT_INVALID', 'MODEL_OUTPUT_INVALID'],
    });
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.current.run?.detail.result).toMatchObject({
      replyZhHant: knowledgeNoSupportedAnswer,
      answerSegments: [{ text: knowledgeNoSupportedAnswer, evidenceRefs: [] }],
      proposedChanges: [],
    });
  });

  it('should require nonempty segments for grounded legacy output and stop after one repair', async () => {
    for (const output of [result, { ...result, answerSegments: [] }]) {
      const ports = fixture({ run: groundedRun(), linked: true, output });
      expect(await ports.handler(ownerId, jobId)).toEqual({
        success: true,
        data: undefined,
      });
      expect(ports.draft).toHaveBeenCalledTimes(2);
      expect(ports.current.run?.detail.result).toMatchObject({
        answerSegments: [
          { text: knowledgeNoSupportedAnswer, evidenceRefs: [] },
        ],
        proposedChanges: [],
      });
    }
  });

  it('should return an initial provider failure without attempting evidence repair', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      modelFailure: true,
    });
    expect(await ports.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(ports.draft).toHaveBeenCalledTimes(1);
    expect(ports.saveResult).not.toHaveBeenCalled();
  });

  it('should reject unauditable malformed responses without writing a result or reply', async () => {
    const ports = fixture({
      run: groundedRun(),
      linked: true,
      modelErrors: ['MODEL_OUTPUT_INVALID', 'MODEL_OUTPUT_INVALID'],
      missingAudit: true,
    });
    expect(await ports.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(ports.draft).toHaveBeenCalledTimes(2);
    expect(ports.current.run?.detail.result).toBeNull();
    expect(ports.saveResult).not.toHaveBeenCalled();
    expect(ports.insertAssistantReply).not.toHaveBeenCalled();
    expect(ports.updateJob).not.toHaveBeenCalled();
  });
});
