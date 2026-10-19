import { describe, expect, it, vi } from 'vitest';

import { recordFieldsOf } from '../record/fields.js';

import { createEditDraftService } from './edit.js';

import type {
  EditDraftApply,
  EditDraftDetail,
  EditDraftRequest,
  EditDraftResult,
  ModelSelection,
  RecordDetail,
  RecordPatch,
} from '@antica/contracts';
import type { Observation } from '@antica/domain';

import type {
  CommandReceipt,
  EditDraftRunRecord,
  OperationResult,
  TranscriptionRunRecord,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const observationId = '00000000-0000-4000-8000-000000000003';
const draftId = '00000000-0000-4000-8000-000000000004';
const proposalId = '00000000-0000-4000-8000-000000000005';
const now = '2026-10-13T12:00:00.000Z';
const selection = {
  role: 'recordEditing',
  modelId: 'development',
  profileVersion: '1',
} satisfies ModelSelection;
const request = {
  requestKey: draftId,
  recordId,
  expectedRecordRevision: 1,
  transcriptionIds: [],
  observationIds: [observationId],
  instructionZhHant: '整理描述',
} satisfies EditDraftRequest;
const apply = {
  requestKey: '00000000-0000-4000-8000-000000000006',
  expectedDraftRevision: 2,
  expectedRecordRevision: 1,
  selectedProposalIds: [proposalId],
} satisfies EditDraftApply;

function record(): RecordDetail {
  return {
    id: recordId,
    code: 'ANT-0001',
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
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    createdAt: now,
    updatedAt: now,
    mediaIds: [],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

function observation(): Observation {
  return {
    id: observationId,
    recordId,
    componentIds: [],
    channel: 'typed',
    text: '青瓷瓶',
    evidenceAnchorIds: [],
    checkIds: [],
    observedAt: now,
    voice: null,
    editDraftId: null,
    supersedesObservationId: null,
    supersededByObservationId: null,
    author: 'collector',
    createdAt: now,
  };
}

function readyRun(
  changes: EditDraftResult['proposedChanges'] = [
    {
      id: proposalId,
      field: 'name',
      before: 'Vase',
      proposed: 'Celadon vase',
      findingIds: [],
    },
  ],
): EditDraftRunRecord {
  const detail: EditDraftDetail = {
    editDraftId: draftId,
    jobId: '00000000-0000-4000-8000-000000000007',
    revision: 2,
    status: 'ready',
    snapshot: {
      recordId,
      versions: {
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
      },
      fields: recordFieldsOf(record()),
      transcriptionVersions: [],
      observationIds: [observationId],
      sourceText: [{ kind: 'observation', id: observationId, text: '青瓷瓶' }],
      createdAt: now,
    },
    result: {
      editDraftId: draftId,
      recordId,
      baseVersions: {
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
      },
      sourceTranscriptionIds: [],
      sourceObservationIds: [observationId],
      replyZhHant: '已整理描述',
      suggestedDescriptionZhHant: '青瓷瓶',
      proposedChanges: changes,
    },
    invocation: null,
    appliedProposalIds: [],
    skippedProposalIds: [],
    createdAt: now,
    updatedAt: now,
  };

  return { detail, request, modelSelection: selection };
}

function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly observation?: Observation | null;
    readonly run?: EditDraftRunRecord | null;
    readonly patchResult?: RecordDetail | null;
    readonly markResult?: EditDraftDetail | null;
    readonly transcription?: TranscriptionRunRecord | null;
  } = {},
) {
  const receipts = new Map<string, CommandReceipt>();
  const current = { run: options.run ?? null };
  const createJob = vi.fn(async () => undefined);
  const createDraft = vi.fn(async (run: EditDraftRunRecord) => {
    current.run = run;
  });
  const enqueue = vi.fn(async () => undefined);
  const patch = vi.fn(async (_id: string, input: RecordPatch) => {
    if ('patchResult' in options) {
      return options.patchResult ?? null;
    }

    return {
      ...record(),
      ...input.fields,
      recordRevision: 2,
      analysisInputVersion: 2,
    };
  });
  // mirrors the repository: applied proposals live on the draft, skipped ones in its history
  const markApplied = vi.fn(
    async (
      ...[, , selected, , skipped = []]: [
        id: string,
        expectedRevision: number,
        selected: readonly string[],
        updatedAt: string,
        skipped?: readonly string[],
      ]
    ): Promise<EditDraftDetail | null> => {
      if ('markResult' in options) {
        return options.markResult ?? null;
      }
      const { detail } = current.run!;
      const applied = [...detail.appliedProposalIds, ...selected];
      const resolved =
        applied.length + detail.skippedProposalIds.length + skipped.length;
      const next: EditDraftDetail = {
        ...detail,
        revision: detail.revision + 1,
        status:
          resolved === detail.result!.proposedChanges.length
            ? 'applied'
            : 'partially_applied',
        appliedProposalIds: applied,
      };
      current.run = { ...current.run!, detail: next };

      return next;
    },
  );
  const appendAdoption = vi.fn(
    async (
      ...[, adoptedId, status]: [
        id: string,
        proposalId: string,
        status: 'accepted' | 'skipped',
        eventId: string,
      ]
    ) => {
      if (status === 'skipped') {
        const { detail } = current.run!;
        current.run = {
          ...current.run!,
          detail: {
            ...detail,
            skippedProposalIds: [...detail.skippedProposalIds, adoptedId],
          },
        };
      }
    },
  );
  const repositories = {
    commands: {
      get: async (_owner: string, operation: string, key: string) =>
        receipts.get(`${operation}:${key}`) ?? null,
      insert: async (receipt: CommandReceipt) => {
        receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
      },
    },
    records: {
      get: async () =>
        'record' in options ? (options.record ?? null) : record(),
      patch,
    },
    evidence: {
      getObservation: async () =>
        'observation' in options
          ? (options.observation ?? null)
          : observation(),
    },
    transcriptions: { get: async () => options.transcription ?? null },
    jobs: { create: createJob },
    outbox: { enqueue },
    editDrafts: {
      create: createDraft,
      get: async () => current.run,
      markApplied,
      appendAdoption,
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
  const service = createEditDraftService(
    transaction,
    selection,
    { now: () => now },
    {
      create: () => '00000000-0000-4000-8000-000000000007',
    },
  );

  return {
    service,
    receipts,
    current,
    createJob,
    createDraft,
    enqueue,
    patch,
    markApplied,
    appendAdoption,
  };
}

describe('fn:createEditDraftService', () => {
  it('should freeze collector text and queue one draft without changing the record', async () => {
    const ports = fixture();
    const first = await ports.service.submit(ownerId, request);
    const replay = await ports.service.submit(ownerId, request);

    expect(first).toEqual({
      success: true,
      data: {
        editDraftId: draftId,
        jobId: '00000000-0000-4000-8000-000000000007',
      },
    });
    expect(replay).toEqual(first);
    expect(ports.createJob).toHaveBeenCalledTimes(1);
    expect(ports.enqueue).toHaveBeenCalledTimes(1);
    expect(ports.current.run?.detail.snapshot).toMatchObject({
      recordId,
      sourceText: [{ kind: 'observation', id: observationId, text: '青瓷瓶' }],
      fields: { name: 'Vase' },
    });
    expect(await ports.service.get(ownerId, draftId)).toMatchObject({
      success: true,
      data: { status: 'pending' },
    });
    expect(ports.patch).not.toHaveBeenCalled();
  });

  it('should reject missing, stale, duplicate, and foreign source selections', async () => {
    const ports = fixture();
    await ports.service.submit(ownerId, request);
    expect(
      await ports.service.submit(ownerId, {
        ...request,
        instructionZhHant: 'different',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({ record: null }).service.submit(ownerId, request),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        record: { ...record(), recordRevision: 2 },
      }).service.submit(ownerId, request),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture().service.submit(ownerId, {
        ...request,
        observationIds: [observationId, observationId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({ observation: null }).service.submit(ownerId, request),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture().service.submit(ownerId, {
        ...request,
        observationIds: [],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should freeze confirmed transcription text only when its observation belongs to the record', async () => {
    const transcriptionId = '00000000-0000-4000-8000-000000000008';
    const transcription: TranscriptionRunRecord = {
      detail: {
        transcriptionId,
        jobId: '00000000-0000-4000-8000-000000000009',
        revision: 3,
        status: 'confirmed',
        snapshot: {
          recordId,
          recordRevision: 1,
          audioAssetId: '00000000-0000-4000-8000-000000000010',
          audioSha256: 'a'.repeat(64),
          createdAt: now,
        },
        result: null,
        invocation: null,
        confirmedObservationId: observationId,
        createdAt: now,
        updatedAt: now,
      },
      request: {
        requestKey: transcriptionId,
        recordId,
        audioAssetId: '00000000-0000-4000-8000-000000000010',
        expectedRecordRevision: 1,
        vocabularyHints: [],
      },
      modelSelection: {
        role: 'transcription',
        modelId: 'development',
        profileVersion: '1',
      },
    };
    const voiceRequest = {
      ...request,
      transcriptionIds: [transcriptionId],
      observationIds: [],
    };
    expect(await fixture().service.submit(ownerId, voiceRequest)).toMatchObject(
      { success: false, error: { code: 'EVIDENCE_INVALID' } },
    );
    expect(
      await fixture({ transcription, observation: null }).service.submit(
        ownerId,
        voiceRequest,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const ports = fixture({ transcription });
    expect(await ports.service.submit(ownerId, voiceRequest)).toMatchObject({
      success: true,
    });
    expect(ports.current.run?.detail.snapshot).toMatchObject({
      transcriptionVersions: [{ id: transcriptionId, revision: 3 }],
      sourceText: [
        { kind: 'transcription', id: transcriptionId, text: '青瓷瓶' },
      ],
    });
    expect(
      await fixture({ transcription }).service.submit(ownerId, {
        ...voiceRequest,
        transcriptionIds: [transcriptionId, transcriptionId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should keep requiring a confirmed transcription for voice edits even when one is ready', async () => {
    const transcriptionId = '00000000-0000-4000-8000-000000000008';
    const ready: TranscriptionRunRecord = {
      detail: {
        transcriptionId,
        jobId: '00000000-0000-4000-8000-000000000009',
        revision: 2,
        status: 'ready',
        snapshot: {
          recordId,
          recordRevision: 1,
          audioAssetId: '00000000-0000-4000-8000-000000000010',
          audioSha256: 'a'.repeat(64),
          createdAt: now,
        },
        result: {
          transcriptionId,
          recordId,
          audioAssetId: '00000000-0000-4000-8000-000000000010',
          originalText: 'raw',
          readingTextZhHant: 'reading',
          detectedLanguages: [],
          uncertainTerms: [],
          segments: [],
        },
        invocation: null,
        confirmedObservationId: null,
        createdAt: now,
        updatedAt: now,
      },
      request: {
        requestKey: transcriptionId,
        recordId,
        audioAssetId: '00000000-0000-4000-8000-000000000010',
        expectedRecordRevision: 1,
        vocabularyHints: [],
      },
      modelSelection: {
        role: 'transcription',
        modelId: 'development',
        profileVersion: '1',
      },
    };
    const ports = fixture({ transcription: ready });

    const result = await ports.service.submit(ownerId, {
      ...request,
      transcriptionIds: [transcriptionId],
      observationIds: [],
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: 'EVIDENCE_INVALID',
        message: 'Confirmed transcription does not belong to record',
        retryable: false,
      },
    });
    expect(ports.current.run).toBeNull();
  });

  it('should apply only the selected proposal with record and draft compare-and-swap', async () => {
    const ports = fixture({ run: readyRun() });
    const first = await ports.service.apply(ownerId, draftId, apply);
    const replay = await ports.service.apply(ownerId, draftId, apply);
    const reused = await ports.service.apply(ownerId, draftId, {
      ...apply,
      selectedProposalIds: [],
    });

    expect(first).toMatchObject({
      success: true,
      data: {
        draft: { status: 'applied' },
        record: { name: 'Celadon vase', recordRevision: 2 },
      },
    });
    expect(replay).toEqual(first);
    expect(reused).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      {
        expectedRevision: 1,
        fields: { name: 'Celadon vase' },
        editDraftId: draftId,
        acceptedProposalIds: [proposalId],
      },
      { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
    );
    expect(ports.markApplied).toHaveBeenCalledTimes(1);
  });

  it('should reject unavailable proposals and concurrent changes before adoption', async () => {
    expect(await fixture().service.get(ownerId, draftId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(
      await fixture().service.apply(ownerId, draftId, apply),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ run: readyRun() }).service.apply(ownerId, draftId, {
        ...apply,
        expectedDraftRevision: 1,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture({ run: readyRun(), record: null }).service.apply(
        ownerId,
        draftId,
        apply,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        run: readyRun(),
        record: { ...record(), recordRevision: 2 },
      }).service.apply(ownerId, draftId, apply),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture({ run: readyRun() }).service.apply(ownerId, draftId, {
        ...apply,
        selectedProposalIds: [proposalId, proposalId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({ run: readyRun() }).service.apply(ownerId, draftId, {
        ...apply,
        selectedProposalIds: ['00000000-0000-4000-8000-000000000099'],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        run: readyRun([
          {
            id: proposalId,
            field: 'name',
            before: 'Other',
            proposed: 'Celadon vase',
            findingIds: [],
          },
        ]),
      }).service.apply(ownerId, draftId, apply),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should reject duplicate fields, invalid values, and previously applied proposals', async () => {
    const secondId = '00000000-0000-4000-8000-000000000011';
    const duplicateField = readyRun([
      {
        id: proposalId,
        field: 'name',
        before: 'Vase',
        proposed: 'Celadon vase',
        findingIds: [],
      },
      {
        id: secondId,
        field: 'name',
        before: 'Vase',
        proposed: 'Other vase',
        findingIds: [],
      },
    ]);
    expect(
      await fixture({ run: duplicateField }).service.apply(ownerId, draftId, {
        ...apply,
        selectedProposalIds: [proposalId, secondId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const invalidValue = readyRun([
      {
        id: proposalId,
        field: 'materialIds',
        before: [],
        proposed: ['bad-id'],
        findingIds: [],
      },
    ]);
    expect(
      await fixture({ run: invalidValue }).service.apply(
        ownerId,
        draftId,
        apply,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const partiallyApplied: EditDraftRunRecord = {
      ...readyRun(),
      detail: {
        ...readyRun().detail,
        status: 'partially_applied',
        appliedProposalIds: [proposalId],
      },
    };
    expect(
      await fixture({ run: partiallyApplied }).service.apply(
        ownerId,
        draftId,
        apply,
      ),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should withhold the receipt when either record or draft compare-and-swap fails', async () => {
    const recordConflict = fixture({ run: readyRun(), patchResult: null });
    expect(
      await recordConflict.service.apply(ownerId, draftId, apply),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(recordConflict.markApplied).not.toHaveBeenCalled();
    const draftConflict = fixture({ run: readyRun(), markResult: null });
    expect(
      await draftConflict.service.apply(ownerId, draftId, apply),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(draftConflict.receipts.size).toBe(0);
    expect(draftConflict.appendAdoption).not.toHaveBeenCalled();
  });
});

describe('fn:createEditDraftService adoption guardrails', () => {
  const descriptionId = '00000000-0000-4000-8000-000000000012';
  const twoFieldRun = (): EditDraftRunRecord =>
    readyRun([
      {
        id: proposalId,
        field: 'name',
        before: 'Vase',
        proposed: 'Celadon vase',
        findingIds: [],
      },
      {
        id: descriptionId,
        field: 'description',
        before: '',
        proposed: '青瓷瓶',
        findingIds: [],
      },
    ]);

  it('should reject a stale displayed revision as retryable without writing', async () => {
    const ports = fixture({
      run: readyRun(),
      record: { ...record(), recordRevision: 2 },
    });

    expect(await ports.service.apply(ownerId, draftId, apply)).toEqual({
      success: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'Record changed before adoption',
        retryable: true,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.appendAdoption).not.toHaveBeenCalled();
  });

  it('should reject an adopted field changed since the draft even when the revision matches', async () => {
    const ports = fixture({
      run: twoFieldRun(),
      record: { ...record(), recordRevision: 3, description: 'Collector edit' },
    });

    expect(
      await ports.service.apply(ownerId, draftId, {
        ...apply,
        expectedRecordRevision: 3,
        selectedProposalIds: [proposalId, descriptionId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'Proposed field changed since draft',
        retryable: true,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.appendAdoption).not.toHaveBeenCalled();
  });

  it('should adopt an unchanged field while an unadopted field changed after the draft (A7)', async () => {
    const ports = fixture({
      run: twoFieldRun(),
      record: { ...record(), recordRevision: 3, description: 'Collector edit' },
    });

    expect(
      await ports.service.apply(ownerId, draftId, {
        ...apply,
        expectedRecordRevision: 3,
      }),
    ).toMatchObject({
      success: true,
      data: { record: { name: 'Celadon vase' } },
    });
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      {
        expectedRevision: 3,
        fields: { name: 'Celadon vase' },
        editDraftId: draftId,
        acceptedProposalIds: [proposalId],
      },
      { recordRevision: 4, analysisInputVersion: 2, evidenceVersion: 1 },
    );
  });

  it('should answer a foreign or missing draft with a not-found result that leaks no record data', async () => {
    const ports = fixture({ run: null });

    expect(await ports.service.apply(ownerId, draftId, apply)).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Ready edit draft not found',
        retryable: false,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
  });

  it('should refuse to reapply a proposal from a fully applied draft', async () => {
    const applied: EditDraftRunRecord = {
      ...readyRun(),
      detail: {
        ...readyRun().detail,
        status: 'applied',
        appliedProposalIds: [proposalId],
      },
    };
    const ports = fixture({ run: applied });

    expect(await ports.service.apply(ownerId, draftId, apply)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', retryable: false },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.appendAdoption).not.toHaveBeenCalled();
  });

  it('should write one accepted history entry per adopted field after the draft is marked', async () => {
    const ports = fixture({ run: twoFieldRun() });

    expect(
      await ports.service.apply(ownerId, draftId, {
        ...apply,
        selectedProposalIds: [proposalId, descriptionId],
      }),
    ).toMatchObject({ success: true });
    expect(ports.appendAdoption.mock.calls).toEqual([
      [draftId, proposalId, 'accepted', expect.any(String)],
      [draftId, descriptionId, 'accepted', expect.any(String)],
    ]);
    expect(ports.markApplied.mock.invocationCallOrder[0]).toBeLessThan(
      ports.appendAdoption.mock.invocationCallOrder[0]!,
    );
  });
});

describe('fn:createEditDraftService skipped proposals', () => {
  const descriptionId = '00000000-0000-4000-8000-000000000012';
  const twoFieldRun = (
    detail: Partial<EditDraftDetail> = {},
  ): EditDraftRunRecord => {
    const run = readyRun([
      {
        id: proposalId,
        field: 'name',
        before: 'Vase',
        proposed: 'Celadon vase',
        findingIds: [],
      },
      {
        id: descriptionId,
        field: 'description',
        before: '',
        proposed: '青瓷瓶',
        findingIds: [],
      },
    ]);

    return { ...run, detail: { ...run.detail, ...detail } };
  };

  it('should record a reject-only adoption as skipped without writing the record', async () => {
    const ports = fixture({ run: readyRun() });

    const result = await ports.service.apply(ownerId, draftId, {
      ...apply,
      selectedProposalIds: [],
      skippedProposalIds: [proposalId],
    });

    expect(result).toEqual({
      success: true,
      data: {
        draft: expect.objectContaining({
          status: 'applied',
          revision: 3,
          appliedProposalIds: [],
          skippedProposalIds: [proposalId],
        }),
        record: record(),
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.markApplied).toHaveBeenCalledExactlyOnceWith(
      draftId,
      2,
      [],
      now,
      [proposalId],
    );
    expect(ports.appendAdoption.mock.calls).toEqual([
      [draftId, proposalId, 'skipped', expect.any(String)],
    ]);
    expect(ports.receipts.size).toBe(1);
  });

  it('should adopt a confirmed proposal and skip a rejected one in one adoption', async () => {
    const ports = fixture({ run: twoFieldRun() });

    const result = await ports.service.apply(ownerId, draftId, {
      ...apply,
      skippedProposalIds: [descriptionId],
    });

    expect(result).toMatchObject({
      success: true,
      data: {
        draft: {
          status: 'applied',
          appliedProposalIds: [proposalId],
          skippedProposalIds: [descriptionId],
        },
        record: { name: 'Celadon vase', recordRevision: 2 },
      },
    });
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      {
        expectedRevision: 1,
        fields: { name: 'Celadon vase' },
        editDraftId: draftId,
        acceptedProposalIds: [proposalId],
      },
      { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
    );
    expect(ports.appendAdoption.mock.calls).toEqual([
      [draftId, proposalId, 'accepted', expect.any(String)],
      [draftId, descriptionId, 'skipped', expect.any(String)],
    ]);
  });

  it('should replay a skipping adoption from its receipt and refuse the key for a different skipped list', async () => {
    const ports = fixture({ run: twoFieldRun() });
    const mixed = { ...apply, skippedProposalIds: [descriptionId] };

    const first = await ports.service.apply(ownerId, draftId, mixed);
    const replay = await ports.service.apply(ownerId, draftId, mixed);
    const reused = await ports.service.apply(ownerId, draftId, {
      ...mixed,
      skippedProposalIds: [],
    });

    expect(first).toMatchObject({ success: true });
    expect(replay).toEqual(first);
    expect(reused).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request key was reused for a different adoption',
        retryable: false,
      },
    });
    expect(ports.markApplied).toHaveBeenCalledTimes(1);
    expect(ports.appendAdoption).toHaveBeenCalledTimes(2);
  });

  it('should treat an omitted and an empty skipped list as the same adoption', async () => {
    const ports = fixture({ run: readyRun() });

    const first = await ports.service.apply(ownerId, draftId, apply);
    const replay = await ports.service.apply(ownerId, draftId, {
      ...apply,
      skippedProposalIds: [],
    });

    expect(first).toMatchObject({ success: true });
    expect(replay).toEqual(first);
    expect(ports.markApplied).toHaveBeenCalledTimes(1);
  });

  it('should fail without a receipt when the draft disappears before it is read back', async () => {
    const ports = fixture({ run: readyRun() });
    ports.appendAdoption.mockImplementation(async () => {
      ports.current.run = null;
    });

    expect(
      await ports.service.apply(ownerId, draftId, {
        ...apply,
        selectedProposalIds: [],
        skippedProposalIds: [proposalId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'Edit draft changed during adoption',
        retryable: true,
      },
    });
    expect(ports.receipts.size).toBe(0);
  });

  it('should skip a proposal whose field changed since the draft (A7)', async () => {
    const ports = fixture({
      run: twoFieldRun(),
      record: { ...record(), recordRevision: 3, description: 'Collector edit' },
    });

    expect(
      await ports.service.apply(ownerId, draftId, {
        ...apply,
        expectedRecordRevision: 3,
        selectedProposalIds: [],
        skippedProposalIds: [descriptionId],
      }),
    ).toMatchObject({
      success: true,
      data: {
        draft: { status: 'partially_applied' },
        record: { recordRevision: 3, description: 'Collector edit' },
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
  });

  it.for([
    ['apply', { selectedProposalIds: [descriptionId] }],
    ['skip', { selectedProposalIds: [], skippedProposalIds: [descriptionId] }],
  ] as const)(
    'should refuse to %s a proposal that was already skipped',
    async ([, decision]) => {
      const ports = fixture({
        run: twoFieldRun({
          status: 'partially_applied',
          skippedProposalIds: [descriptionId],
        }),
      });

      expect(
        await ports.service.apply(ownerId, draftId, {
          ...apply,
          selectedProposalIds: [...decision.selectedProposalIds],
          skippedProposalIds:
            'skippedProposalIds' in decision
              ? [...decision.skippedProposalIds]
              : undefined,
        }),
      ).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Selected proposal is unavailable',
          retryable: false,
        },
      });
      expect(ports.markApplied).not.toHaveBeenCalled();
      expect(ports.appendAdoption).not.toHaveBeenCalled();
    },
  );

  it('should refuse to skip an applied or unknown proposal', async () => {
    const partiallyApplied = twoFieldRun({
      status: 'partially_applied',
      appliedProposalIds: [proposalId],
    });

    for (const skippedId of [
      proposalId,
      '00000000-0000-4000-8000-000000000099',
    ]) {
      expect(
        await fixture({ run: partiallyApplied }).service.apply(
          ownerId,
          draftId,
          {
            ...apply,
            selectedProposalIds: [],
            skippedProposalIds: [skippedId],
          },
        ),
      ).toMatchObject({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Selected proposal is unavailable',
        },
      });
    }
  });

  it.for([
    ['overlapping', [proposalId], [proposalId]],
    ['duplicate skipped', [], [descriptionId, descriptionId]],
  ] as const)(
    'should reject %s decisions before writing',
    async ([, selectedProposalIds, skippedProposalIds]) => {
      const ports = fixture({ run: twoFieldRun() });

      expect(
        await ports.service.apply(ownerId, draftId, {
          ...apply,
          selectedProposalIds: [...selectedProposalIds],
          skippedProposalIds: [...skippedProposalIds],
        }),
      ).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Select or skip each proposal once',
          retryable: false,
        },
      });
      expect(ports.patch).not.toHaveBeenCalled();
      expect(ports.markApplied).not.toHaveBeenCalled();
    },
  );
});
