import { describe, expect, it, vi } from 'vitest';

import { recordFieldsOf } from '../record/fields.js';

import { createAnalysisService } from './service.js';

import type {
  ActionState,
  AnalysisOutput,
  MediaAsset,
  ModelSelection,
  RecordDetail,
  ReferenceLink,
} from '@antica/contracts';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';

import type {
  AnalysisRunRecord,
  CommandReceipt,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const now = '2026-10-13T12:00:00.000Z';
const ownerId = 'collector-1';
const recordId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const snapshotId = '00000000-0000-4000-8000-000000000004';
const actionId = '00000000-0000-4000-8000-000000000005';
const proposalId = '00000000-0000-4000-8000-000000000006';
const assetId = '00000000-0000-4000-8000-000000000007';
const viewId = '00000000-0000-4000-8000-000000000008';
const anchorId = '00000000-0000-4000-8000-000000000009';
const observationId = '00000000-0000-4000-8000-000000000010';
const checkId = '00000000-0000-4000-8000-000000000011';
const selection: ModelSelection = {
  role: 'analysis',
  modelId: 'analysis-default',
  profileVersion: 'v1',
};
const record: RecordDetail = {
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
  analysisInputVersion: 2,
  evidenceVersion: 3,
  createdAt: now,
  updatedAt: now,
  mediaIds: [],
  checkIds: [],
  latestRunId: null,
  analysisFreshness: 'unanalyzed',
};
const output: AnalysisOutput = {
  summary: 'A ceramic vase',
  findings: [],
  uncertainties: [],
  suggestedMethodIds: [],
  nextActions: [
    {
      id: actionId,
      kind: 'describe',
      instruction: 'Inspect foot',
      reason: 'The foot is undocumented',
    },
  ],
  proposedChanges: [
    {
      id: proposalId,
      field: 'name',
      before: 'Vase',
      proposed: 'Blue vase',
      findingIds: [],
    },
  ],
};
const state: ActionState = {
  runId,
  actionId,
  recordId,
  revision: 1,
  status: 'pending',
  latestResolutionId: null,
  updatedAt: now,
};
const media: MediaAsset = {
  id: assetId,
  owner: { kind: 'record', recordId },
  kind: 'photo',
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
const anchor: EvidenceAnchor = {
  id: anchorId,
  recordId,
  componentIds: [],
  originalAssetId: assetId,
  canonicalViewId: viewId,
  scope: { kind: 'whole' },
  kind: 'image',
  createdAt: now,
};
const observation: Observation = {
  id: observationId,
  recordId,
  componentIds: [],
  channel: 'typed',
  text: 'Blue glaze',
  evidenceAnchorIds: [anchorId],
  checkIds: [],
  observedAt: now,
  voice: null,
  editDraftId: null,
  supersedesObservationId: null,
  author: 'collector',
  createdAt: now,
  supersededByObservationId: null,
};
const check: RecordCheck = {
  id: checkId,
  revision: 1,
  createdAt: now,
  updatedAt: now,
  recordId,
  componentIds: [],
  methodId: actionId,
  methodVersionId: proposalId,
  suggestedByRunId: null,
  progress: 'recorded',
  result: { kind: 'present' },
  observationIds: [observationId],
  evidenceAnchorIds: [anchorId],
  pendingActionIds: [],
};
const reference: ReferenceLink = {
  id: actionId,
  target: {
    recordId,
    checkId: null,
    observationId: null,
    evidenceAnchorId: null,
  },
  reference: {
    kind: 'collection',
    recordId,
    originalAssetId: assetId,
    evidenceAnchorId: null,
  },
  comparisonId: null,
  noteZhHant: '',
  createdAt: now,
  versions: { recordRevision: 1, analysisInputVersion: 2, evidenceVersion: 3 },
};

function completedRun(): AnalysisRunRecord {
  return {
    id: runId,
    jobId,
    recordId,
    requestedSnapshot: {
      id: snapshotId,
      recordId,
      recordRevision: 1,
      analysisInputVersion: 2,
      evidenceVersion: 3,
      assetIds: [],
      evidenceIds: [],
      observationIds: [],
      checkIds: [],
      frozenPack: {
        recordFields: recordFieldsOf(record),
        media: [],
        evidence: [],
        observations: [],
        checks: [],
      },
      createdAt: now,
    },
    modelSelection: selection,
    input: null,
    retrievalSnapshot: null,
    output,
    invocation: null,
    failureAudits: [],
    suggestedMethodVersions: [],
    status: 'completed',
  };
}

function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly run?: AnalysisRunRecord | null;
    readonly snapshotRun?: AnalysisRunRecord | null;
    readonly actionState?: ActionState | null;
    readonly proposalStates?: ReadonlyArray<{
      readonly proposalId: string;
      readonly status: 'pending' | 'accepted' | 'skipped';
      readonly latestAdoptionEventId: string | null;
    }>;
    readonly patch?: RecordDetail | null;
    readonly versions?: boolean;
    readonly actionUpdate?: boolean;
    readonly capability?: OperationResult<{
      readonly effectiveModelId: string;
      readonly capabilities: {
        readonly textInput: boolean;
        readonly imageInput: boolean;
        readonly audioInput: boolean;
        readonly structuredOutput: boolean;
        readonly toolCalling: boolean;
      };
    }>;
    readonly media?: ReadonlyMap<string, MediaAsset>;
    readonly anchors?: readonly EvidenceAnchor[];
    readonly observations?: readonly Observation[];
    readonly checks?: ReadonlyMap<string, RecordCheck>;
    readonly anchor?: EvidenceAnchor;
    readonly observation?: Observation;
    readonly check?: RecordCheck;
    readonly reference?: ReferenceLink;
  } = {},
) {
  const current: {
    record: RecordDetail | null;
    run: AnalysisRunRecord | null;
  } = {
    record: 'record' in options ? (options.record ?? null) : record,
    run: 'run' in options ? (options.run ?? null) : null,
  };
  const receipts = new Map<string, CommandReceipt>();
  const created: AnalysisRunRecord[] = [];
  const queued: string[] = [];
  const adoptions: Array<{ proposalId: string; status: string }> = [];
  let nextId = 0;
  const ids = {
    create: vi.fn(
      () =>
        [
          snapshotId,
          runId,
          jobId,
          'outbox-1',
          'event-1',
          'resolution-1',
          'adoption-1',
          'adoption-2',
        ][nextId++] ?? 'extra-id',
    ),
  };
  const patch = vi.fn(
    async (_id: string, _input: unknown, _versions: unknown) => {
      if ('patch' in options) {
        return options.patch ?? null;
      }
      const changed = current.record
        ? {
            ...current.record,
            name: 'Blue vase',
            recordRevision: current.record.recordRevision + 1,
          }
        : null;
      current.record = changed;

      return changed;
    },
  );
  const bumpVersions = vi.fn(async () =>
    options.versions === false
      ? null
      : {
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 3,
        },
  );
  const updateActionState = vi.fn(async () => options.actionUpdate !== false);
  const getAnchor = vi.fn(async () => options.anchor ?? null);
  const getObservation = vi.fn(async () => options.observation ?? null);
  const getCheck = vi.fn(
    async (id: string) => options.checks?.get(id) ?? options.check ?? null,
  );
  const getReference = vi.fn(async () => options.reference ?? null);
  const observationQueries: Array<string | undefined> = [];
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      _owner: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      const repositories = {
        records: { get: async () => current.record, patch, bumpVersions },
        commands: {
          get: async (_owner: string, operation: string, key: string) =>
            receipts.get(`${operation}:${key}`) ?? null,
          insert: async (receipt: CommandReceipt) => {
            receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
          },
        },
        media: { get: async (id: string) => options.media?.get(id) ?? null },
        evidence: {
          queryAnchorsByAsset: async () => options.anchors ?? [],
          queryObservations: async (_recordId: string, cursor?: string) => {
            observationQueries.push(cursor);
            if (!options.observations) {
              return { items: [], nextCursor: null };
            }

            return cursor
              ? { items: options.observations.slice(1), nextCursor: null }
              : { items: options.observations.slice(0, 1), nextCursor: 'next' };
          },
          getCheck,
          getAnchor,
          getObservation,
        },
        analyses: {
          get: async () => current.run,
          getBySnapshotId: async () => options.snapshotRun ?? null,
          create: async (run: AnalysisRunRecord) => {
            created.push(run);
            current.run = run;
          },
          getActionState: async () =>
            'actionState' in options ? (options.actionState ?? null) : state,
          getProposalStates: async () =>
            options.proposalStates ?? [
              {
                proposalId,
                status: 'pending' as const,
                latestAdoptionEventId: null,
              },
            ],
          appendAdoption: async (_run: string, id: string, status: string) => {
            adoptions.push({ proposalId: id, status });
          },
          updateActionState,
          queryTasks: async () => ({ items: [], nextCursor: null }),
        },
        jobs: {
          create: async (job: { id: string }) => {
            queued.push(job.id);
          },
        },
        outbox: { enqueue: async () => undefined },
        research: { getReference },
      };

      return operation(
        new Proxy({} as UnitOfWork, {
          get: (_target, key) =>
            key in repositories ? Reflect.get(repositories, key) : undefined,
        }),
      );
    },
  };
  const catalog = {
    resolve: vi.fn(
      async () =>
        options.capability ?? {
          success: true as const,
          data: {
            effectiveModelId: selection.modelId,
            capabilities: {
              textInput: true,
              imageInput: true,
              audioInput: false,
              structuredOutput: true,
              toolCalling: false,
            },
          },
        },
    ),
  };
  const service = createAnalysisService(
    transaction,
    catalog,
    selection,
    { now: () => now },
    ids,
  );

  return {
    service,
    current,
    receipts,
    created,
    queued,
    adoptions,
    patch,
    bumpVersions,
    updateActionState,
    getAnchor,
    getObservation,
    getCheck,
    getReference,
    catalog,
    ids,
    observationQueries,
  };
}

describe('fn:createAnalysisService', () => {
  it('should freeze a record snapshot and queue one analysis job', async () => {
    const ports = fixture();

    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
      }),
    ).toEqual({
      success: true,
      data: {
        runId,
        jobId,
        status: 'queued',
        inputSnapshotId: snapshotId,
        analysisInputVersion: 2,
      },
    });
    expect(ports.created).toMatchObject([
      {
        id: runId,
        jobId,
        recordId,
        requestedSnapshot: {
          recordRevision: 1,
          analysisInputVersion: 2,
          evidenceVersion: 3,
          frozenPack: { recordFields: { name: 'Vase' } },
        },
      },
    ]);
    expect(ports.queued).toEqual([jobId]);
    expect(ports.receipts.get('analysis.request:request-1')).toMatchObject({
      status: 202,
    });
  });

  it('should freeze only ready object media with their evidence, observations, and checks', async () => {
    const waitingId = '00000000-0000-4000-8000-000000000012';
    const receiptId = '00000000-0000-4000-8000-000000000013';
    const ports = fixture({
      record: {
        ...record,
        mediaIds: [assetId, waitingId, receiptId],
        checkIds: [checkId, actionId],
      },
      media: new Map([
        [assetId, media],
        [waitingId, { ...media, id: waitingId, state: 'uploaded' }],
        [receiptId, { ...media, id: receiptId, purpose: 'receipt' }],
      ]),
      anchors: [anchor],
      observations: [
        observation,
        { ...observation, id: actionId, text: 'Underglaze mark' },
      ],
      checks: new Map([[checkId, check]]),
    });

    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
      }),
    ).toMatchObject({ success: true, data: { runId } });
    expect(ports.created[0]?.requestedSnapshot).toMatchObject({
      assetIds: [assetId],
      evidenceIds: [anchorId],
      observationIds: [observationId, actionId],
      checkIds: [checkId],
      frozenPack: {
        media: [media],
        evidence: [anchor],
        observations: [observation, { id: actionId }],
        checks: [check],
      },
    });
    expect(ports.observationQueries).toEqual([undefined, 'next']);
  });

  it('should decline a request when its selected model lacks required capabilities', async () => {
    const ports = fixture({
      capability: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Unavailable',
          retryable: true,
        },
      },
    });

    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
        modelId: 'unavailable',
      }),
    ).toMatchObject({ success: false, error: { code: 'JOB_FAILED' } });
    expect(ports.catalog.resolve).toHaveBeenCalledWith(
      {
        ...selection,
        modelId: 'unavailable',
      },
      { textInput: true, imageInput: true, structuredOutput: true },
    );
    expect(ports.queued).toEqual([]);
  });

  it('should replay an identical request and reject changed input under one key', async () => {
    const ports = fixture();
    const first = await ports.service.request(ownerId, recordId, 'request-1', {
      expectedRecordRevision: 1,
    });

    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
      }),
    ).toEqual(first);
    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
        modelId: 'other',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(ports.created).toHaveLength(1);
  });

  it('should reject a missing or changed record before creating a job', async () => {
    expect(
      await fixture({ record: null }).service.request(
        ownerId,
        recordId,
        'request-1',
        { expectedRecordRevision: 1 },
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const changed = fixture();
    expect(
      await changed.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 2,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(changed.queued).toEqual([]);
  });

  it('should reject a snapshot that is absent or belongs to another record', async () => {
    const missing = fixture();
    expect(
      await missing.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
        inputSnapshotId: snapshotId,
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const other = fixture({
      snapshotRun: { ...completedRun(), recordId: 'another-record' },
    });
    expect(
      await other.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
        inputSnapshotId: snapshotId,
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('should reuse the same frozen snapshot under a new analysis run', async () => {
    const ports = fixture({ snapshotRun: completedRun() });

    expect(
      await ports.service.request(ownerId, recordId, 'request-1', {
        expectedRecordRevision: 1,
        inputSnapshotId: snapshotId,
      }),
    ).toMatchObject({ success: true, data: { inputSnapshotId: snapshotId } });
    expect(ports.created[0]?.requestedSnapshot).toEqual(
      completedRun().requestedSnapshot,
    );
  });

  it('should expose a completed run and its current proposal and action states', async () => {
    const ports = fixture({ run: completedRun() });

    expect(await ports.service.get(ownerId, runId)).toMatchObject({
      success: true,
      data: {
        runId,
        jobId,
        status: 'completed',
        snapshot: { id: snapshotId, retrievalSnapshotId: null },
        result: {
          output,
          actionStates: [state],
          proposalStates: [{ proposalId }],
        },
      },
    });
    expect(await fixture().service.get(ownerId, runId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('should expose a queued run without an output or action states', async () => {
    const run = { ...completedRun(), output: null, status: 'queued' as const };
    const ports = fixture({ run, proposalStates: [] });

    expect(await ports.service.get(ownerId, runId)).toMatchObject({
      success: true,
      data: {
        runId,
        status: 'queued',
        result: {
          output: null,
          actionStates: [],
          proposalStates: [],
        },
      },
    });
  });

  it('should expose retained failure audits when a later run has output', async () => {
    const audit = {
      invocation: null,
      rawOutput: { summary: 'Provider draft' },
    };
    const ports = fixture({
      run: { ...completedRun(), failureAudits: [audit] },
    });

    expect(await ports.service.get(ownerId, runId)).toMatchObject({
      success: true,
      data: { status: 'completed', failureAudits: [audit], result: { output } },
    });
  });

  it('should omit action states removed after a run completed', async () => {
    const ports = fixture({ run: completedRun(), actionState: null });

    expect(await ports.service.get(ownerId, runId)).toMatchObject({
      success: true,
      data: { result: { actionStates: [] } },
    });
  });

  it('should project the bound retrieval citation and input snapshot ID', async () => {
    const citation = {
      id: checkId,
      locator: {
        kind: 'web' as const,
        sourceId: actionId,
        sourceVersionId: proposalId,
        url: 'https://museum.example/vase',
        retrievedAt: now,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: 'Blue glaze',
      },
      relation: 'supports' as const,
      availability: 'link_only' as const,
      verification: 'located' as const,
    };
    const run: AnalysisRunRecord = {
      ...completedRun(),
      input: {
        recordId,
        snapshotId,
        recordRevision: 1,
        analysisInputVersion: 2,
        evidenceVersion: 3,
        assetIds: [],
        evidenceIds: [],
        observationIds: [],
        checkIds: [],
        retrievalSnapshotId: assetId,
        promptVersion: 'v1',
        schemaVersion: 'v1',
      },
      retrievalSnapshot: {
        id: assetId,
        index: { embeddingModelId: 'embed', dimensions: 3, indexVersion: 'v1' },
        citations: [citation],
        text: [],
        methods: [],
        createdAt: now,
      },
    };

    expect(await fixture({ run }).service.get(ownerId, runId)).toMatchObject({
      success: true,
      data: {
        snapshot: { retrievalSnapshotId: assetId },
        citations: [citation],
      },
    });
  });

  it('should return task projections from the owner-scoped repository', async () => {
    const ports = fixture();

    expect(await ports.service.tasks(ownerId, { recordId })).toEqual({
      success: true,
      data: { items: [], nextCursor: null },
    });
  });

  it('should adopt a pending proposed field and persist its adoption receipt', async () => {
    const ports = fixture({ run: completedRun() });
    const input = {
      expectedRecordRevision: 1,
      selectedProposalIds: [proposalId],
    };

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', input),
    ).toMatchObject({
      success: true,
      data: { name: 'Blue vase', recordRevision: 2 },
    });
    expect(ports.adoptions).toEqual([{ proposalId, status: 'accepted' }]);
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      {
        expectedRevision: 1,
        fields: { name: 'Blue vase' },
      },
      { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 3 },
    );
    expect(ports.receipts.get('analysis.apply:apply-1')).toMatchObject({
      status: 200,
    });
  });

  it('should apply each supported proposed field with its typed value', async () => {
    const ids = [
      proposalId,
      ...[7, 8, 9, 10, 11].map(
        (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
      ),
    ];
    const changes: AnalysisOutput['proposedChanges'] = [
      {
        id: ids[0]!,
        field: 'name',
        before: record.name,
        proposed: 'Blue vase',
        findingIds: [],
      },
      {
        id: ids[1]!,
        field: 'description',
        before: record.description,
        proposed: 'Blue glazed',
        findingIds: [],
      },
      {
        id: ids[2]!,
        field: 'materialIds',
        before: record.materialIds,
        proposed: [assetId],
        findingIds: [],
      },
      {
        id: ids[3]!,
        field: 'period',
        before: record.period,
        proposed: null,
        findingIds: [],
      },
      {
        id: ids[4]!,
        field: 'tags',
        before: record.tags,
        proposed: ['blue'],
        findingIds: [],
      },
      {
        id: ids[5]!,
        field: 'collectorJudgment',
        before: record.collectorJudgment,
        proposed: 'Likely antique',
        findingIds: [],
      },
    ];
    const run = {
      ...completedRun(),
      output: { ...output, proposedChanges: changes },
    };
    const ports = fixture({
      run,
      proposalStates: ids.map((id) => ({
        proposalId: id,
        status: 'pending',
        latestAdoptionEventId: null,
      })),
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-all', {
        expectedRecordRevision: 1,
        selectedProposalIds: ids,
      }),
    ).toMatchObject({ success: true });
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      {
        expectedRevision: 1,
        fields: {
          name: 'Blue vase',
          description: 'Blue glazed',
          materialIds: [assetId],
          period: null,
          tags: ['blue'],
          collectorJudgment: 'Likely antique',
        },
      },
      { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 3 },
    );
    expect(ports.adoptions).toEqual(
      ids.map((id) => ({
        proposalId: id,
        status: 'accepted',
      })),
    );
  });

  it('should replay an adoption and reject changed selection under the same key', async () => {
    const ports = fixture({ run: completedRun() });
    const input = {
      expectedRecordRevision: 1,
      selectedProposalIds: [proposalId],
    };
    const first = await ports.service.apply(ownerId, runId, 'apply-1', input);

    expect(await ports.service.apply(ownerId, runId, 'apply-1', input)).toEqual(
      first,
    );
    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(ports.adoptions).toHaveLength(1);
  });

  it('should reject adoption when the run or record is absent or the record changed', async () => {
    expect(
      await fixture().service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ run: completedRun(), record: null }).service.apply(
        ownerId,
        runId,
        'apply-1',
        {
          expectedRecordRevision: 1,
          selectedProposalIds: [proposalId],
        },
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ run: completedRun() }).service.apply(
        ownerId,
        runId,
        'apply-1',
        { expectedRecordRevision: 2, selectedProposalIds: [proposalId] },
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should reject unknown, already adopted, and stale proposed fields', async () => {
    const unknown = fixture({ run: completedRun() });
    expect(
      await unknown.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [actionId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const adopted = fixture({
      run: completedRun(),
      proposalStates: [
        {
          proposalId,
          status: 'accepted',
          latestAdoptionEventId: 'event-1',
        },
      ],
    });
    expect(
      await adopted.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const stale = fixture({
      run: completedRun(),
      record: { ...record, name: 'Other vase' },
    });
    expect(
      await stale.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should reject a concurrent record patch without recording adoption', async () => {
    const conflict = fixture({ run: completedRun(), patch: null });
    expect(
      await conflict.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(conflict.adoptions).toEqual([]);
  });

  it('should record a skipped proposal without patching an unselected field', async () => {
    const skippedId = '00000000-0000-4000-8000-000000000007';
    const run = {
      ...completedRun(),
      output: {
        ...output,
        proposedChanges: [
          ...output.proposedChanges,
          {
            id: skippedId,
            field: 'description' as const,
            before: '',
            proposed: 'Later',
            findingIds: [],
          },
        ],
      },
    };
    const ports = fixture({
      run,
      proposalStates: [
        { proposalId, status: 'pending', latestAdoptionEventId: null },
        {
          proposalId: skippedId,
          status: 'pending',
          latestAdoptionEventId: null,
        },
      ],
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
        skippedProposalIds: [skippedId],
      }),
    ).toMatchObject({ success: true, data: { name: 'Blue vase' } });
    expect(ports.adoptions).toEqual([
      { proposalId, status: 'accepted' },
      { proposalId: skippedId, status: 'skipped' },
    ]);
  });

  it('should resolve an action with collector support and updated record versions', async () => {
    const ports = fixture({ run: completedRun() });
    const input = {
      status: 'supplied' as const,
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
      support: { onSiteDescription: 'Foot has a firing mark' },
    };

    expect(
      await ports.service.resolveAction(
        ownerId,
        runId,
        actionId,
        'resolve-1',
        input,
      ),
    ).toMatchObject({
      success: true,
      data: {
        state: { revision: 2, status: 'supplied' },
        resolution: {
          runId,
          actionId,
          status: 'supplied',
          support: input.support,
          reason: null,
          resolvedBy: 'collector',
        },
        versions: { recordRevision: 2 },
      },
    });
    expect(ports.bumpVersions).toHaveBeenCalledWith(recordId, 1, {
      analysisInput: false,
      evidence: false,
    });
    expect(
      ports.receipts.get('analysis.resolveAction:resolve-1'),
    ).toMatchObject({ status: 200 });
  });

  it('should replay a resolution and reject a changed disposition under one key', async () => {
    const ports = fixture({ run: completedRun() });
    const supplied = {
      status: 'supplied' as const,
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
      support: { onSiteDescription: 'Inspected' },
    };
    const first = await ports.service.resolveAction(
      ownerId,
      runId,
      actionId,
      'resolve-1',
      supplied,
    );

    expect(
      await ports.service.resolveAction(
        ownerId,
        runId,
        actionId,
        'resolve-1',
        supplied,
      ),
    ).toEqual(first);
    expect(
      await ports.service.resolveAction(ownerId, runId, actionId, 'resolve-1', {
        status: 'dismissed',
        expectedActionRevision: 1,
        expectedRecordRevision: 1,
        reason: 'Not relevant',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(ports.updateActionState).toHaveBeenCalledTimes(1);
  });

  it('should reject action resolution when the action, record, or revisions are stale', async () => {
    const input = {
      status: 'dismissed' as const,
      reason: 'Not relevant',
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
    };
    expect(
      await fixture().service.resolveAction(
        ownerId,
        runId,
        actionId,
        'resolve-1',
        input,
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        run: completedRun(),
        actionState: null,
      }).service.resolveAction(ownerId, runId, actionId, 'resolve-1', input),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({
        run: completedRun(),
        record: null,
      }).service.resolveAction(ownerId, runId, actionId, 'resolve-1', input),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ run: completedRun() }).service.resolveAction(
        ownerId,
        runId,
        actionId,
        'resolve-1',
        { ...input, expectedActionRevision: 2 },
      ),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should reject foreign supporting evidence and changed resolution state', async () => {
    const supported = {
      status: 'supplied' as const,
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
    };
    for (const support of [
      { evidenceAnchorIds: [actionId] },
      { observationIds: [actionId] },
      { checkIds: [actionId] },
      { referenceLinkIds: [actionId] },
    ]) {
      expect(
        await fixture({ run: completedRun() }).service.resolveAction(
          ownerId,
          runId,
          actionId,
          'resolve-1',
          { ...supported, support },
        ),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    }
    expect(
      await fixture({
        run: completedRun(),
        versions: false,
      }).service.resolveAction(ownerId, runId, actionId, 'resolve-1', {
        status: 'dismissed',
        reason: 'Not relevant',
        expectedActionRevision: 1,
        expectedRecordRevision: 1,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture({
        run: completedRun(),
        actionUpdate: false,
      }).service.resolveAction(ownerId, runId, actionId, 'resolve-1', {
        status: 'dismissed',
        reason: 'Not relevant',
        expectedActionRevision: 1,
        expectedRecordRevision: 1,
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
  });

  it('should reject present support owned by another record', async () => {
    const foreignRecordId = '00000000-0000-4000-8000-000000000099';
    const supported = {
      status: 'supplied' as const,
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
    };
    const cases = [
      {
        options: { anchor: { ...anchor, recordId: foreignRecordId } },
        support: { evidenceAnchorIds: [anchorId] },
      },
      {
        options: { observation: { ...observation, recordId: foreignRecordId } },
        support: { observationIds: [observationId] },
      },
      {
        options: { check: { ...check, recordId: foreignRecordId } },
        support: { checkIds: [checkId] },
      },
      {
        options: {
          reference: {
            ...reference,
            target: { ...reference.target, recordId: foreignRecordId },
          },
        },
        support: { referenceLinkIds: [actionId] },
      },
    ];
    for (const { options, support } of cases) {
      const ports = fixture({ run: completedRun(), ...options });
      expect(
        await ports.service.resolveAction(
          ownerId,
          runId,
          actionId,
          'resolve-1',
          { ...supported, support },
        ),
      ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
      expect(ports.bumpVersions).not.toHaveBeenCalled();
    }
  });

  it('should accept support already attached to the same record', async () => {
    const ports = fixture({
      run: completedRun(),
      anchor,
      observation,
      check,
      reference,
    });

    expect(
      await ports.service.resolveAction(ownerId, runId, actionId, 'resolve-1', {
        status: 'supplied',
        expectedActionRevision: 1,
        expectedRecordRevision: 1,
        support: {
          evidenceAnchorIds: [anchorId],
          observationIds: [observationId],
          checkIds: [checkId],
          referenceLinkIds: [actionId],
        },
      }),
    ).toMatchObject({
      success: true,
      data: { state: { status: 'supplied' } },
    });
    expect(ports.bumpVersions).toHaveBeenCalledTimes(1);
  });
});

describe('fn:createAnalysisService adoption guardrails', () => {
  const descriptionId = '00000000-0000-4000-8000-000000000012';
  const tagsId = '00000000-0000-4000-8000-000000000013';
  const pending = (id: string) => ({
    proposalId: id,
    status: 'pending' as const,
    latestAdoptionEventId: null,
  });
  const threeFieldRun = (): AnalysisRunRecord => ({
    ...completedRun(),
    output: {
      ...output,
      proposedChanges: [
        ...output.proposedChanges,
        {
          id: descriptionId,
          field: 'description',
          before: '',
          proposed: 'Blue glaze',
          findingIds: [],
        },
        {
          id: tagsId,
          field: 'tags',
          before: [],
          proposed: ['blue'],
          findingIds: [],
        },
      ],
    },
  });
  const threeFieldStates = [
    pending(proposalId),
    pending(descriptionId),
    pending(tagsId),
  ];

  it('should reject a stale displayed revision as retryable without writing', async () => {
    const ports = fixture({
      run: completedRun(),
      record: { ...record, recordRevision: 2 },
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'Record changed before adoption',
        retryable: true,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.adoptions).toEqual([]);
    expect(ports.receipts.size).toBe(0);
  });

  it('should reject an adopted field changed since the analysis even when the revision matches', async () => {
    const ports = fixture({
      run: threeFieldRun(),
      record: { ...record, recordRevision: 4, description: 'Collector edit' },
      proposalStates: threeFieldStates,
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 4,
        selectedProposalIds: [proposalId, descriptionId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'REVISION_CONFLICT',
        message: 'A proposed field changed since analysis',
        retryable: true,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
    expect(ports.adoptions).toEqual([]);
  });

  it('should adopt unchanged fields while unadopted fields changed after the analysis (A7)', async () => {
    const ports = fixture({
      run: threeFieldRun(),
      record: {
        ...record,
        recordRevision: 4,
        description: 'Collector edit',
        tags: ['collector'],
      },
      proposalStates: threeFieldStates,
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 4,
        selectedProposalIds: [proposalId],
        skippedProposalIds: [descriptionId],
      }),
    ).toMatchObject({ success: true, data: { recordRevision: 5 } });
    expect(ports.patch).toHaveBeenCalledWith(
      recordId,
      { expectedRevision: 4, fields: { name: 'Blue vase' } },
      { recordRevision: 5, analysisInputVersion: 2, evidenceVersion: 3 },
    );
    expect(ports.adoptions).toEqual([
      { proposalId, status: 'accepted' },
      { proposalId: descriptionId, status: 'skipped' },
    ]);
  });

  it('should answer a foreign or missing run with a not-found result that leaks no record data', async () => {
    const ports = fixture({ run: null });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Completed analysis not found',
        retryable: false,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
  });

  it.for(['accepted', 'skipped'] as const)(
    'should refuse to apply or skip a proposal that was already %s',
    async (status) => {
      const decided = {
        proposalId,
        status,
        latestAdoptionEventId: 'adoption-0',
      };
      const reapply = fixture({
        run: completedRun(),
        proposalStates: [decided],
      });
      const reskip = fixture({
        run: completedRun(),
        proposalStates: [decided],
      });

      expect(
        await reapply.service.apply(ownerId, runId, 'apply-1', {
          expectedRecordRevision: 1,
          selectedProposalIds: [proposalId],
        }),
      ).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Selected proposal is unavailable',
          retryable: false,
        },
      });
      expect(
        await reskip.service.apply(ownerId, runId, 'apply-1', {
          expectedRecordRevision: 1,
          selectedProposalIds: [],
          skippedProposalIds: [proposalId],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      expect(reapply.patch).not.toHaveBeenCalled();
      expect([...reapply.adoptions, ...reskip.adoptions]).toEqual([]);
    },
  );

  it('should reject a proposal decided twice in one request before writing history', async () => {
    const ports = fixture({
      run: threeFieldRun(),
      proposalStates: threeFieldStates,
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId],
        skippedProposalIds: [descriptionId, descriptionId],
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
    expect(ports.adoptions).toEqual([]);
  });

  it('should reject two selected proposals for the same field', async () => {
    const otherNameId = '00000000-0000-4000-8000-000000000014';
    const ports = fixture({
      run: {
        ...completedRun(),
        output: {
          ...output,
          proposedChanges: [
            ...output.proposedChanges,
            {
              id: otherNameId,
              field: 'name',
              before: 'Vase',
              proposed: 'Green vase',
              findingIds: [],
            },
          ],
        },
      },
      proposalStates: [pending(proposalId), pending(otherNameId)],
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId, otherNameId],
      }),
    ).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Select only one change per field',
        retryable: false,
      },
    });
    expect(ports.patch).not.toHaveBeenCalled();
  });

  it('should write one history entry for every adopted and skipped field with distinct identifiers', async () => {
    const ports = fixture({
      run: threeFieldRun(),
      proposalStates: threeFieldStates,
    });

    expect(
      await ports.service.apply(ownerId, runId, 'apply-1', {
        expectedRecordRevision: 1,
        selectedProposalIds: [proposalId, descriptionId],
        skippedProposalIds: [tagsId],
      }),
    ).toMatchObject({ success: true });
    expect(ports.adoptions).toEqual([
      { proposalId, status: 'accepted' },
      { proposalId: descriptionId, status: 'accepted' },
      { proposalId: tagsId, status: 'skipped' },
    ]);
    expect(ports.ids.create).toHaveBeenCalledTimes(3);
  });
});
