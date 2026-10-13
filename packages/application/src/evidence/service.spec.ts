import { describe, expect, it, vi } from 'vitest';

import { createEvidenceService } from './service.js';

import type {
  CheckCreate,
  CheckPatch,
  EvidenceCreateRequest,
  MediaAsset,
  ObservationInput,
  RecordDetail,
} from '@antica/contracts';
import type {
  EvidenceAnchor,
  FrameLocator,
  Observation,
  RecordCheck,
} from '@antica/domain';

import type {
  CommandReceipt,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000003';
const viewId = '00000000-0000-4000-8000-000000000004';
const anchorId = '00000000-0000-4000-8000-000000000005';
const checkId = '00000000-0000-4000-8000-000000000006';
const observationId = '00000000-0000-4000-8000-000000000007';
const methodId = '00000000-0000-4000-8000-000000000008';
const methodVersionId = '00000000-0000-4000-8000-000000000009';
const componentId = '00000000-0000-4000-8000-000000000010';
const runId = '00000000-0000-4000-8000-000000000011';
const frameId = '00000000-0000-4000-8000-000000000015';
const now = '2026-10-13T12:00:00.000Z';
const createAnchorRequest: EvidenceCreateRequest = {
  requestKey: '00000000-0000-4000-8000-000000000012',
  mode: 'create',
  evidence: {
    recordId,
    componentIds: [],
    originalAssetId: assetId,
    canonicalViewId: viewId,
    scope: { kind: 'whole' },
    kind: 'image',
  },
};
const observationInput: ObservationInput = {
  recordId,
  componentIds: [],
  channel: 'typed',
  text: 'The glaze is blue',
  evidenceAnchorIds: [],
  checkIds: [],
  observedAt: now,
  voice: null,
  editDraftId: null,
  supersedesObservationId: null,
};
const checkCreate: CheckCreate = {
  expectedRecordRevision: 1,
  methodId,
  methodVersionId,
};
const checkPatch: CheckPatch = {
  requestKey: '00000000-0000-4000-8000-000000000013',
  expectedRevision: 1,
  expectedRecordRevision: 1,
  progress: 'recorded',
  result: { kind: 'present' },
  addObservationIds: [observationId],
  addEvidenceAnchorIds: [anchorId],
};

function record(): RecordDetail {
  return {
    id: recordId,
    code: 'ANT-0001',
    name: 'Vase',
    unitKind: 'single',
    components: [{ id: componentId, label: 'Lid' }],
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
    mediaIds: [assetId],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

function media(kind: MediaAsset['kind'] = 'photo'): MediaAsset {
  return {
    id: assetId,
    owner: { kind: 'record', recordId },
    kind,
    purpose: 'object',
    state: 'ready',
    componentIds: [],
    originalFileName: 'vase.jpg',
    mimeType: 'image/jpeg',
    byteLength: 4,
    sha256: 'a'.repeat(64),
    durationMs: null,
    views: [
      {
        id: viewId,
        originalAssetId: assetId,
        derivativeId: null,
        width: 10,
        height: 10,
        originalCoordinateSpace: 'image_pixels',
        transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
      },
    ],
    createdAt: now,
  };
}

function anchor(): EvidenceAnchor {
  if (createAnchorRequest.mode !== 'create') {
    throw new Error('invalid fixture');
  }

  return { ...createAnchorRequest.evidence, id: anchorId, createdAt: now };
}

function observation(): Observation {
  return {
    ...observationInput,
    id: observationId,
    author: 'collector',
    createdAt: now,
    supersededByObservationId: null,
  };
}

function check(): RecordCheck {
  return {
    id: checkId,
    recordId,
    componentIds: [],
    methodId,
    methodVersionId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    suggestedByRunId: null,
    progress: 'not_started',
    result: { kind: 'unrecorded' },
    observationIds: [],
    evidenceAnchorIds: [],
    pendingActionIds: [],
  };
}

function frame(): FrameLocator {
  return {
    streamIndex: 0,
    timeBase: { numerator: 1, denominator: 1000 },
    pts: '1200',
    frameDerivativeId: frameId,
    displayTimeMs: 1200,
  };
}

function video(): MediaAsset {
  return {
    ...media('video'),
    views: [
      {
        ...media().views[0]!,
        derivativeId: frameId,
        originalCoordinateSpace: 'video_frame_pixels',
      },
    ],
  };
}

function videoRequest(): Extract<EvidenceCreateRequest, { mode: 'create' }> {
  return {
    requestKey: '00000000-0000-4000-8000-000000000016',
    mode: 'create',
    evidence: {
      recordId,
      componentIds: [],
      originalAssetId: assetId,
      canonicalViewId: viewId,
      scope: { kind: 'whole' },
      kind: 'video_frame',
      frame: frame(),
    },
  };
}

function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly media?: MediaAsset | null;
    readonly anchor?: EvidenceAnchor | null;
    readonly observation?: Observation | null;
    readonly check?: RecordCheck | null;
    readonly activeCheck?: RecordCheck | null;
    readonly methodVersion?: { readonly methodId: string } | null;
    readonly suggestedRun?: {
      readonly recordId: string;
      readonly suggestedMethodVersions: ReadonlyArray<{
        readonly methodId: string;
        readonly methodVersionId: string;
      }>;
    } | null;
    readonly frame?: FrameLocator | null;
    readonly bump?: boolean;
    readonly updateCheck?: boolean;
  } = {},
) {
  const receipts = new Map<string, CommandReceipt>();
  const addAnchor = vi.fn(async () => undefined);
  const addObservation = vi.fn(async () => undefined);
  const supersedeObservation = vi.fn(async () => undefined);
  const addCheck = vi.fn(async () => undefined);
  const updateCheck = vi.fn(async () => options.updateCheck !== false);
  const bumpVersions = vi.fn(async () =>
    options.bump === false
      ? null
      : {
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 2,
        },
  );
  const createJob = vi.fn(async () => undefined);
  const enqueue = vi.fn(async () => undefined);
  const repositories = {
    commands: {
      get: vi.fn(
        async (_owner: string, operation: string, key: string) =>
          receipts.get(`${operation}:${key}`) ?? null,
      ),
      insert: vi.fn(async (receipt: CommandReceipt) => {
        receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
      }),
    },
    records: {
      get: vi.fn(async () =>
        'record' in options ? (options.record ?? null) : record(),
      ),
      bumpVersions,
    },
    media: {
      get: vi.fn(async () =>
        'media' in options ? (options.media ?? null) : media(),
      ),
      getFrameByDerivative: vi.fn(async () => options.frame ?? null),
    },
    evidence: {
      getAnchor: vi.fn(async () =>
        'anchor' in options ? (options.anchor ?? null) : anchor(),
      ),
      addAnchor,
      getObservation: vi.fn(async () =>
        'observation' in options
          ? (options.observation ?? null)
          : observation(),
      ),
      addObservation,
      supersedeObservation,
      queryObservations: vi.fn(async () => ({
        items: [observation()],
        nextCursor: null,
      })),
      getCheck: vi.fn(async () =>
        'check' in options ? (options.check ?? null) : check(),
      ),
      findActiveCheck: vi.fn(async () => options.activeCheck ?? null),
      addCheck,
      updateCheck,
    },
    jobs: { create: createJob },
    outbox: { enqueue },
    knowledge: {
      getMethodVersion: vi.fn(async () =>
        'methodVersion' in options
          ? (options.methodVersion ?? null)
          : { methodId },
      ),
    },
    analyses: { get: vi.fn(async () => options.suggestedRun ?? null) },
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
  const ids = { create: vi.fn(() => anchorId) };
  const service = createEvidenceService(transaction, { now: () => now }, ids);

  return {
    service,
    receipts,
    repositories,
    addAnchor,
    addObservation,
    supersedeObservation,
    addCheck,
    updateCheck,
    bumpVersions,
    createJob,
    enqueue,
  };
}

describe('fn:createEvidenceService', () => {
  it('should create a record-owned image anchor once and advance evidence versions', async () => {
    const ports = fixture();
    const first = await ports.service.createAnchor(
      ownerId,
      createAnchorRequest,
    );
    const replay = await ports.service.createAnchor(
      ownerId,
      createAnchorRequest,
    );
    expect(first).toMatchObject({
      success: true,
      data: { recordId, originalAssetId: assetId, kind: 'image' },
    });
    expect(replay).toEqual(first);
    expect(ports.addAnchor).toHaveBeenCalledTimes(1);
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: true,
    });
    expect(
      ports.receipts.get(`evidence.create:${createAnchorRequest.requestKey}`),
    ).toMatchObject({ status: 201 });
  });

  it('should reject missing records, unrelated views, and version conflicts before accepting evidence', async () => {
    expect(
      await fixture({ record: null }).service.createAnchor(
        ownerId,
        createAnchorRequest,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ media: null }).service.createAnchor(
        ownerId,
        createAnchorRequest,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: { ...media(), state: 'processing' },
      }).service.createAnchor(ownerId, createAnchorRequest),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ media: { ...media(), views: [] } }).service.createAnchor(
        ownerId,
        createAnchorRequest,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: {
          ...media(),
          views: [
            {
              ...media().views[0]!,
              originalCoordinateSpace: 'pdf_page_points',
            },
          ],
        },
      }).service.createAnchor(ownerId, createAnchorRequest),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: {
          ...media(),
          owner: { kind: 'source_intake', intakeKey: assetId },
        },
      }).service.createAnchor(ownerId, createAnchorRequest),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ check: null }).service.createAnchor(ownerId, {
        ...createAnchorRequest,
        checkId,
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const conflict = fixture({ bump: false });
    expect(
      await conflict.service.createAnchor(ownerId, createAnchorRequest),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(conflict.receipts.size).toBe(0);
  });

  it('should accept only the exact prepared video frame and a check on the same record', async () => {
    const valid = fixture({ media: video(), frame: frame() });
    expect(
      await valid.service.createAnchor(ownerId, videoRequest()),
    ).toMatchObject({
      success: true,
      data: { kind: 'video_frame', frame: frame() },
    });
    expect(
      await fixture({ media: video(), frame: frame() }).service.createAnchor(
        ownerId,
        {
          ...videoRequest(),
          checkId,
        },
      ),
    ).toMatchObject({ success: true });
    expect(
      await fixture({ media: video(), frame: null }).service.createAnchor(
        ownerId,
        videoRequest(),
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: video(),
        frame: { ...frame(), pts: 'changed' },
      }).service.createAnchor(ownerId, videoRequest()),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: media('photo'),
        frame: frame(),
      }).service.createAnchor(ownerId, videoRequest()),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: video(),
        frame: frame(),
        check: { ...check(), recordId: assetId },
      }).service.createAnchor(ownerId, {
        ...videoRequest(),
        checkId,
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should queue video frame preparation without creating evidence yet', async () => {
    const video = { ...media('video'), views: [] };
    const ports = fixture({ media: video });
    const request: EvidenceCreateRequest = {
      requestKey: '00000000-0000-4000-8000-000000000014',
      mode: 'prepare_frame',
      recordId,
      originalAssetId: assetId,
      requestedTimeMs: 1200,
    };
    expect(await ports.service.createAnchor(ownerId, request)).toMatchObject({
      success: true,
      data: {
        kind: 'media',
        resourceId: assetId,
        result: { requestedTimeMs: 1200 },
      },
    });
    expect(ports.createJob).toHaveBeenCalledTimes(1);
    expect(ports.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'antica.media.frame_requested' }),
    );
    expect(ports.addAnchor).not.toHaveBeenCalled();
    expect(
      await fixture({ media: media('photo') }).service.createAnchor(
        ownerId,
        request,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should add and list collector observations only for the owning record', async () => {
    const ports = fixture();
    const first = await ports.service.addObservation(
      ownerId,
      'observation-1',
      observationInput,
    );
    const replay = await ports.service.addObservation(
      ownerId,
      'observation-1',
      observationInput,
    );
    expect(first).toMatchObject({
      success: true,
      data: {
        author: 'collector',
        text: 'The glaze is blue',
        supersededByObservationId: null,
      },
    });
    expect(replay).toEqual(first);
    expect(ports.addObservation).toHaveBeenCalledTimes(1);
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: false,
    });
    expect(
      await ports.service.observations(ownerId, recordId, 'cursor-1', 10),
    ).toMatchObject({
      success: true,
      data: { items: [{ id: observationId }] },
    });
    expect(ports.repositories.evidence.queryObservations).toHaveBeenCalledWith(
      recordId,
      'cursor-1',
      10,
    );
    expect(
      await fixture({ record: null }).service.observations(ownerId, recordId),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('should reject observations with missing records, unrelated links, or lost version updates', async () => {
    expect(
      await fixture({ record: null }).service.addObservation(
        ownerId,
        'observation-1',
        observationInput,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ anchor: null }).service.addObservation(
        ownerId,
        'observation-1',
        {
          ...observationInput,
          evidenceAnchorIds: [anchorId],
        },
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ check: null }).service.addObservation(
        ownerId,
        'observation-1',
        {
          ...observationInput,
          checkIds: [checkId],
        },
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const conflict = fixture({ bump: false });
    expect(
      await conflict.service.addObservation(
        ownerId,
        'observation-1',
        observationInput,
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(conflict.receipts.size).toBe(0);
  });

  it('should link valid evidence and checks, verify voice ownership, and supersede an observation', async () => {
    const linked = {
      ...observationInput,
      evidenceAnchorIds: [anchorId],
      checkIds: [checkId],
      supersedesObservationId: observationId,
    };
    const ports = fixture();
    expect(
      await ports.service.addObservation(ownerId, 'observation-2', linked),
    ).toMatchObject({
      success: true,
      data: { evidenceAnchorIds: [anchorId], checkIds: [checkId] },
    });
    expect(ports.supersedeObservation).toHaveBeenCalledWith(
      observationId,
      anchorId,
    );
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: true,
    });
    const voice = {
      ...observationInput,
      channel: 'voice' as const,
      voice: { audioAssetId: assetId, transcriptionId: runId, segmentId: null },
    };
    expect(
      await fixture({
        media: { ...media(), kind: 'audio' },
      }).service.addObservation(ownerId, 'observation-3', voice),
    ).toMatchObject({ success: true });
    expect(
      await fixture({ media: null }).service.addObservation(
        ownerId,
        'observation-3',
        voice,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture().service.addObservation(ownerId, 'observation-3', voice),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        media: {
          ...media(),
          kind: 'audio',
          owner: {
            kind: 'source_intake',
            intakeKey: assetId,
          },
        },
      }).service.addObservation(ownerId, 'observation-3', voice),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ observation: null }).service.addObservation(
        ownerId,
        'observation-4',
        linked,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        observation: { ...observation(), recordId: assetId },
      }).service.addObservation(ownerId, 'observation-4', linked),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should create an inspection once and return an existing active one without duplication', async () => {
    const ports = fixture();
    const first = await ports.service.createCheck(
      ownerId,
      recordId,
      'check-1',
      checkCreate,
    );
    const replay = await ports.service.createCheck(
      ownerId,
      recordId,
      'check-1',
      checkCreate,
    );
    expect(first).toMatchObject({
      success: true,
      data: {
        recordId,
        methodVersionId,
        progress: 'not_started',
        result: { kind: 'unrecorded' },
      },
    });
    expect(replay).toEqual(first);
    expect(ports.addCheck).toHaveBeenCalledTimes(1);
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: false,
    });
    const existing = fixture({ activeCheck: check() });
    expect(
      await existing.service.createCheck(
        ownerId,
        recordId,
        'check-2',
        checkCreate,
      ),
    ).toEqual({ success: true, data: check() });
    expect(existing.addCheck).not.toHaveBeenCalled();
  });

  it('should validate an inspection record, revision, component, and method before writing', async () => {
    expect(
      await fixture({ record: null }).service.createCheck(
        ownerId,
        recordId,
        'check-1',
        checkCreate,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        record: { ...record(), recordRevision: 2 },
      }).service.createCheck(ownerId, recordId, 'check-1', checkCreate),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture().service.createCheck(ownerId, recordId, 'check-1', {
        ...checkCreate,
        componentIds: ['00000000-0000-4000-8000-000000000099'],
      }),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ methodVersion: null }).service.createCheck(
        ownerId,
        recordId,
        'check-1',
        checkCreate,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        methodVersion: { methodId: 'different' },
      }).service.createCheck(ownerId, recordId, 'check-1', checkCreate),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ bump: false }).service.createCheck(
        ownerId,
        recordId,
        'check-1',
        checkCreate,
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should accept a suggested method only when the pinned run offered that version', async () => {
    const suggested = {
      ...checkCreate,
      componentIds: [componentId],
      suggestedByRunId: runId,
    };
    expect(
      await fixture().service.createCheck(
        ownerId,
        recordId,
        'check-2',
        suggested,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        suggestedRun: {
          recordId: assetId,
          suggestedMethodVersions: [{ methodId, methodVersionId }],
        },
      }).service.createCheck(ownerId, recordId, 'check-2', suggested),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        suggestedRun: { recordId, suggestedMethodVersions: [] },
      }).service.createCheck(ownerId, recordId, 'check-2', suggested),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({
        suggestedRun: {
          recordId,
          suggestedMethodVersions: [{ methodId, methodVersionId: assetId }],
        },
      }).service.createCheck(ownerId, recordId, 'check-2', suggested),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    const ports = fixture({
      suggestedRun: {
        recordId,
        suggestedMethodVersions: [{ methodId, methodVersionId }],
      },
    });
    expect(
      await ports.service.createCheck(ownerId, recordId, 'check-2', suggested),
    ).toMatchObject({
      success: true,
      data: { componentIds: [componentId], suggestedByRunId: runId },
    });
  });

  it('should read and update an inspection with validated links and compare-and-swap', async () => {
    const ports = fixture();
    expect(await ports.service.getCheck(ownerId, checkId)).toEqual({
      success: true,
      data: check(),
    });
    expect(
      await fixture({ check: null }).service.getCheck(ownerId, checkId),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const first = await ports.service.updateCheck(ownerId, checkId, checkPatch);
    const replay = await ports.service.updateCheck(
      ownerId,
      checkId,
      checkPatch,
    );
    expect(first).toMatchObject({
      success: true,
      data: {
        progress: 'recorded',
        result: { kind: 'present' },
        observationIds: [observationId],
        evidenceAnchorIds: [anchorId],
        revision: 2,
      },
    });
    expect(replay).toEqual(first);
    expect(ports.updateCheck).toHaveBeenCalledTimes(1);
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: true,
    });
  });

  it('should reject update conflicts, unrelated links, and implicit observation creation', async () => {
    expect(
      await fixture({ check: null }).service.updateCheck(
        ownerId,
        checkId,
        checkPatch,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ record: null }).service.updateCheck(
        ownerId,
        checkId,
        checkPatch,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture().service.updateCheck(ownerId, checkId, {
        ...checkPatch,
        expectedRevision: 2,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture().service.updateCheck(ownerId, checkId, {
        ...checkPatch,
        newObservation: observationInput,
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({ anchor: null }).service.updateCheck(
        ownerId,
        checkId,
        checkPatch,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ observation: null }).service.updateCheck(
        ownerId,
        checkId,
        checkPatch,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ updateCheck: false }).service.updateCheck(
        ownerId,
        checkId,
        checkPatch,
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    const conflict = fixture({ bump: false });
    expect(
      await conflict.service.updateCheck(ownerId, checkId, checkPatch),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(conflict.receipts.size).toBe(0);
  });

  it('should reject reused command keys and preserve existing inspection links on an unlinked update', async () => {
    const ports = fixture({
      check: {
        ...check(),
        observationIds: [observationId],
        evidenceAnchorIds: [anchorId],
      },
    });
    const minimal = {
      requestKey: checkPatch.requestKey,
      expectedRevision: 1,
      expectedRecordRevision: 1,
    } satisfies CheckPatch;
    const first = await ports.service.updateCheck(ownerId, checkId, minimal);
    expect(first).toMatchObject({
      success: true,
      data: {
        progress: 'not_started',
        result: { kind: 'unrecorded' },
        observationIds: [observationId],
        evidenceAnchorIds: [anchorId],
      },
    });
    expect(
      await ports.service.updateCheck(ownerId, checkId, {
        ...minimal,
        progress: 'recorded',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: true,
      evidence: false,
    });
    const creation = fixture();
    await creation.service.createCheck(
      ownerId,
      recordId,
      'check-3',
      checkCreate,
    );
    expect(
      await creation.service.createCheck(ownerId, recordId, 'check-3', {
        ...checkCreate,
        componentIds: [componentId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const observationPorts = fixture();
    await observationPorts.service.addObservation(
      ownerId,
      'observation-5',
      observationInput,
    );
    expect(
      await observationPorts.service.addObservation(ownerId, 'observation-5', {
        ...observationInput,
        text: 'Changed',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const anchorPorts = fixture();
    await anchorPorts.service.createAnchor(ownerId, createAnchorRequest);
    expect(
      await anchorPorts.service.createAnchor(ownerId, {
        ...createAnchorRequest,
        checkId,
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });
});
