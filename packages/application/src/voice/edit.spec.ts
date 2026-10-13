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
      suggestedDescriptionZhHant: '青瓷瓶',
      proposedChanges: changes,
    },
    invocation: null,
    appliedProposalIds: [],
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
  const markApplied = vi.fn(async () =>
    'markResult' in options
      ? (options.markResult ?? null)
      : {
          ...current.run!.detail,
          revision: 3,
          status: 'applied' as const,
          appliedProposalIds: [proposalId],
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
  });
});
