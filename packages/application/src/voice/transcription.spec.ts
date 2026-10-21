import { describe, expect, it, vi } from 'vitest';

import { createTranscriptionService } from './transcription.js';

import type {
  MediaAsset,
  ModelSelection,
  RecordDetail,
  TranscriptionConfirm,
  TranscriptionDetail,
  TranscriptionResult,
  TranscriptionSubmit,
} from '@antica/contracts';
import type { EvidenceAnchor, RecordCheck } from '@antica/domain';

import type {
  CommandReceipt,
  OperationResult,
  TranscriptionRunRecord,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const audioId = '00000000-0000-4000-8000-000000000003';
const transcriptionId = '00000000-0000-4000-8000-000000000004';
const now = '2026-10-13T12:00:00.000Z';
const selection = {
  role: 'transcription',
  modelId: 'development',
  profileVersion: '1',
} satisfies ModelSelection;
const submit = {
  requestKey: transcriptionId,
  recordId,
  audioAssetId: audioId,
  expectedRecordRevision: 1,
  vocabularyHints: ['celadon'],
} satisfies TranscriptionSubmit;
const confirm = {
  requestKey: '00000000-0000-4000-8000-000000000005',
  expectedRevision: 2,
  expectedRecordRevision: 1,
  adoptedTextZhHant: '青瓷瓶',
  componentIds: [],
  evidenceAnchorIds: [],
  checkIds: [],
  observedAt: now,
} satisfies TranscriptionConfirm;
const result = {
  transcriptionId,
  recordId,
  audioAssetId: audioId,
  originalText: '青瓷瓶',
  readingTextZhHant: '青瓷瓶',
  detectedLanguages: ['zh'],
  uncertainTerms: [],
  segments: [],
} satisfies TranscriptionResult;

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
    condition: null,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    createdAt: now,
    updatedAt: now,
    mediaIds: [audioId],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

function audio(): MediaAsset {
  return {
    id: audioId,
    owner: { kind: 'record', recordId },
    kind: 'audio',
    purpose: 'voice_note',
    state: 'ready',
    componentIds: [],
    originalFileName: 'note.m4a',
    mimeType: 'audio/mp4',
    byteLength: 4,
    sha256: 'a'.repeat(64),
    durationMs: 500,
    views: [],
    createdAt: now,
  };
}

function readyRun(): TranscriptionRunRecord {
  const detail: TranscriptionDetail = {
    transcriptionId,
    jobId: '00000000-0000-4000-8000-000000000006',
    revision: 2,
    status: 'ready',
    snapshot: {
      recordId,
      recordRevision: 1,
      audioAssetId: audioId,
      audioSha256: 'a'.repeat(64),
      createdAt: now,
    },
    result,
    invocation: null,
    confirmedObservationId: null,
    createdAt: now,
    updatedAt: now,
  };

  return { detail, request: submit, modelSelection: selection };
}

function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly audio?: MediaAsset | null;
    readonly run?: TranscriptionRunRecord | null;
    readonly bump?: boolean;
    readonly confirm?: boolean;
    readonly anchor?: EvidenceAnchor | null;
    readonly check?: RecordCheck | null;
  } = {},
) {
  const receipts = new Map<string, CommandReceipt>();
  const current = { run: options.run ?? null };
  const createJob = vi.fn(async () => undefined);
  const createRun = vi.fn(async (run: TranscriptionRunRecord) => {
    current.run = run;
  });
  const enqueue = vi.fn(async () => undefined);
  const addObservation = vi.fn(async () => undefined);
  const bumpVersions = vi.fn(async () =>
    options.bump === false
      ? null
      : {
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 1,
        },
  );
  const confirmRun = vi.fn(async () =>
    options.confirm === false
      ? null
      : {
          ...current.run!.detail,
          revision: 3,
          status: 'confirmed' as const,
          confirmedObservationId: '00000000-0000-4000-8000-000000000007',
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
      bumpVersions,
    },
    media: {
      get: async () => ('audio' in options ? (options.audio ?? null) : audio()),
    },
    jobs: { create: createJob },
    outbox: { enqueue },
    transcriptions: {
      create: createRun,
      get: async () => current.run,
      confirm: confirmRun,
    },
    evidence: {
      addObservation,
      getAnchor: async () => options.anchor ?? null,
      getCheck: async () => options.check ?? null,
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
  const service = createTranscriptionService(
    transaction,
    selection,
    { now: () => now },
    {
      create: () => '00000000-0000-4000-8000-000000000006',
    },
  );

  return {
    service,
    receipts,
    current,
    createJob,
    createRun,
    enqueue,
    addObservation,
    bumpVersions,
    confirmRun,
  };
}

describe('fn:createTranscriptionService', () => {
  it('should queue a frozen audio job once and expose its pending detail', async () => {
    const ports = fixture();
    const first = await ports.service.submit(ownerId, submit);
    const replay = await ports.service.submit(ownerId, submit);

    expect(first).toEqual({
      success: true,
      data: {
        transcriptionId,
        jobId: '00000000-0000-4000-8000-000000000006',
      },
    });
    expect(replay).toEqual(first);
    expect(ports.createJob).toHaveBeenCalledTimes(1);
    expect(ports.enqueue).toHaveBeenCalledTimes(1);
    expect(ports.current.run?.detail).toMatchObject({
      status: 'pending',
      result: null,
      snapshot: {
        recordId,
        audioAssetId: audioId,
        audioSha256: 'a'.repeat(64),
      },
    });
    expect(await ports.service.get(ownerId, transcriptionId)).toMatchObject({
      success: true,
      data: { status: 'pending' },
    });
  });

  it('should reject reused request keys, missing records, changed records, and unrelated audio', async () => {
    const ports = fixture();
    await ports.service.submit(ownerId, submit);
    expect(
      await ports.service.submit(ownerId, {
        ...submit,
        vocabularyHints: ['other'],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({ record: null }).service.submit(ownerId, submit),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        record: { ...record(), recordRevision: 2 },
      }).service.submit(ownerId, submit),
    ).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(
      await fixture({
        audio: { ...audio(), state: 'awaiting_upload' },
      }).service.submit(ownerId, submit),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ audio: null }).service.submit(ownerId, submit),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(ports.createJob).toHaveBeenCalledTimes(1);
  });

  it('should require explicit confirmation before adding a collector observation', async () => {
    const ports = fixture({ run: readyRun() });
    const first = await ports.service.confirm(
      ownerId,
      transcriptionId,
      confirm,
    );
    const replay = await ports.service.confirm(
      ownerId,
      transcriptionId,
      confirm,
    );

    expect(first).toMatchObject({
      success: true,
      data: {
        transcription: { status: 'confirmed' },
        observation: {
          text: '青瓷瓶',
          channel: 'voice',
          author: 'collector',
          voice: { audioAssetId: audioId, transcriptionId },
        },
        versions: { recordRevision: 2, analysisInputVersion: 2 },
      },
    });
    expect(replay).toEqual(first);
    expect(ports.addObservation).toHaveBeenCalledTimes(1);
    expect(ports.confirmRun).toHaveBeenCalledTimes(1);
  });

  it('should reject stale confirmation and unrelated evidence without a command receipt', async () => {
    expect(await fixture().service.get(ownerId, transcriptionId)).toMatchObject(
      { success: false, error: { code: 'NOT_FOUND' } },
    );
    expect(
      await fixture().service.confirm(ownerId, transcriptionId, confirm),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ run: readyRun() }).service.confirm(
        ownerId,
        transcriptionId,
        {
          ...confirm,
          expectedRevision: 1,
        },
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture({ run: readyRun(), record: null }).service.confirm(
        ownerId,
        transcriptionId,
        confirm,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        run: readyRun(),
        record: { ...record(), recordRevision: 2 },
      }).service.confirm(ownerId, transcriptionId, confirm),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture({ run: readyRun() }).service.confirm(
        ownerId,
        transcriptionId,
        {
          ...confirm,
          componentIds: ['00000000-0000-4000-8000-000000000010'],
        },
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should reject compare-and-swap failures before recording adoption', async () => {
    const changedRecord = fixture({ run: readyRun(), bump: false });
    expect(
      await changedRecord.service.confirm(ownerId, transcriptionId, confirm),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(changedRecord.confirmRun).not.toHaveBeenCalled();
    const changedRun = fixture({ run: readyRun(), confirm: false });
    expect(
      await changedRun.service.confirm(ownerId, transcriptionId, confirm),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(changedRun.receipts.size).toBe(0);
  });

  it('should preserve a selected component on the adopted observation', async () => {
    const componentId = '00000000-0000-4000-8000-000000000013';
    const ports = fixture({
      run: readyRun(),
      record: { ...record(), components: [{ id: componentId, label: 'Lid' }] },
    });
    expect(
      await ports.service.confirm(ownerId, transcriptionId, {
        ...confirm,
        componentIds: [componentId],
      }),
    ).toMatchObject({
      success: true,
      data: { observation: { componentIds: [componentId] } },
    });
  });

  it('should validate linked evidence and inspection ownership before adoption', async () => {
    const anchor: EvidenceAnchor = {
      id: '00000000-0000-4000-8000-000000000008',
      recordId,
      componentIds: [],
      originalAssetId: audioId,
      canonicalViewId: '00000000-0000-4000-8000-000000000009',
      scope: { kind: 'whole' },
      kind: 'image',
      createdAt: now,
    };
    const check: RecordCheck = {
      id: '00000000-0000-4000-8000-000000000010',
      recordId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      componentIds: [],
      methodId: '00000000-0000-4000-8000-000000000011',
      methodVersionId: '00000000-0000-4000-8000-000000000012',
      suggestedByRunId: null,
      progress: 'not_started',
      result: { kind: 'unrecorded' },
      observationIds: [],
      evidenceAnchorIds: [],
      pendingActionIds: [],
    };
    const linked = {
      ...confirm,
      evidenceAnchorIds: [anchor.id],
      checkIds: [check.id],
    };
    expect(
      await fixture({ run: readyRun() }).service.confirm(
        ownerId,
        transcriptionId,
        linked,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ run: readyRun(), anchor }).service.confirm(
        ownerId,
        transcriptionId,
        linked,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const accepted = fixture({ run: readyRun(), anchor, check });
    expect(
      await accepted.service.confirm(ownerId, transcriptionId, linked),
    ).toMatchObject({
      success: true,
      data: {
        observation: { evidenceAnchorIds: [anchor.id], checkIds: [check.id] },
      },
    });
    expect(accepted.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: true,
    });
    expect(
      await accepted.service.confirm(ownerId, transcriptionId, {
        ...linked,
        adoptedTextZhHant: 'changed',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });
});
