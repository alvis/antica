import { describe, expect, it, vi } from 'vitest';

import { recordFieldsOf } from '../record/fields.js';

import { createAnalysisHandler } from './handler.js';

import type {
  AnalysisOutput,
  JobEnvelope,
  MediaAsset,
  ModelInvocation,
  ModelSelection,
  RecordDetail,
} from '@antica/contracts';
import type {
  CanonicalView,
  EvidenceAnchor,
  Observation,
  RecordCheck,
} from '@antica/domain';

import type {
  AnalysisRunRecord,
  MediaDerivative,
  ModelOperationResult,
  OperationResult,
  RetrievalSnapshot,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { AnalysisHandlerParams } from './handler.js';

const now = '2026-10-13T12:00:00.000Z';
const ownerId = 'collector-1';
const recordId = '00000000-0000-4000-8000-000000000001';
const runId = '00000000-0000-4000-8000-000000000002';
const jobId = '00000000-0000-4000-8000-000000000003';
const snapshotId = '00000000-0000-4000-8000-000000000004';
const retrievalId = '00000000-0000-4000-8000-000000000005';
const assetId = '00000000-0000-4000-8000-000000000006';
const viewId = '00000000-0000-4000-8000-000000000007';
const anchorId = '00000000-0000-4000-8000-000000000008';
const derivativeId = '00000000-0000-4000-8000-000000000009';
const cropId = '00000000-0000-4000-8000-000000000010';
const observationId = '00000000-0000-4000-8000-000000000011';
const checkId = '00000000-0000-4000-8000-000000000012';
const methodId = '00000000-0000-4000-8000-000000000013';
const methodVersionId = '00000000-0000-4000-8000-000000000014';
const selection: ModelSelection = {
  role: 'analysis',
  modelId: 'analysis-default',
  profileVersion: 'v1',
};
const index = { embeddingModelId: 'embed', dimensions: 3, indexVersion: 'v1' };
const capabilities = {
  textInput: true,
  imageInput: true,
  audioInput: false,
  structuredOutput: true,
  toolCalling: false,
};
const invocation: ModelInvocation = {
  requestedModelId: selection.modelId,
  effectiveModelId: selection.modelId,
  provider: 'development',
  providerModelVersion: null,
  adapterKind: 'development',
  capabilities,
  role: 'analysis',
  profileVersion: 'v1',
  promptVersion: 'analysis-prompt-v1',
  schemaVersion: 'analysis-output-v1',
  effectiveOptions: {},
  latencyMs: 1,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};
const failureAudit = {
  invocation,
  rawOutput: {
    summary: 'Draft from provider',
    findings: [{ text: 'Unverified glaze' }],
  },
};
const output: AnalysisOutput = {
  summary: 'A vase',
  findings: [],
  uncertainties: [],
  suggestedMethodIds: [],
  nextActions: [],
  proposedChanges: [],
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
  condition: null,
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
const job: JobEnvelope = {
  id: jobId,
  kind: 'analysis',
  resourceId: runId,
  state: { kind: 'queued' },
  createdAt: now,
  updatedAt: now,
  result: null,
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
  methodId,
  methodVersionId,
  suggestedByRunId: null,
  progress: 'recorded',
  result: { kind: 'present' },
  observationIds: [observationId],
  evidenceAnchorIds: [anchorId],
  pendingActionIds: [],
};
const derivative: MediaDerivative = {
  id: derivativeId,
  originalAssetId: assetId,
  parentDerivativeId: null,
  kind: 'canonical',
  storageKey: `derivatives/${derivativeId}`,
  mimeType: 'image/jpeg',
  byteLength: 4,
  sha256: 'b'.repeat(64),
  region: null,
  transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};
const citation = {
  id: cropId,
  locator: {
    kind: 'web' as const,
    sourceId: methodId,
    sourceVersionId: methodVersionId,
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
const retrieved: RetrievalSnapshot = {
  id: retrievalId,
  index,
  citations: [citation],
  text: [
    {
      citationId: cropId,
      contentAsRetrieved: 'Blue glaze',
      sourceRegionId: null,
    },
  ],
  methods: [
    {
      methodId,
      methodVersionId,
      owningEntryId: recordId,
      titleZhHant: 'Examine glaze',
      definition: {
        titleZhHant: 'Examine glaze',
        history: [],
        featureEntryIds: [],
        applicability: [],
        observationModes: ['in_person_visual'],
        steps: [],
        interpretationLimits: [],
        exampleReferenceImageIds: [],
        citations: [],
      },
    },
  ],
  createdAt: now,
};
const supportedOutput: AnalysisOutput = {
  summary: 'A blue vase',
  uncertainties: [],
  findings: [
    {
      id: viewId,
      kind: 'visualObservation',
      text: 'Blue glaze',
      evidenceIds: [anchorId],
      observationIds: [observationId],
      citationIds: [cropId],
      relation: 'supports',
      certainty: 'observed',
    },
  ],
  suggestedMethodIds: [methodId],
  nextActions: [],
  proposedChanges: [],
};

function evidenceRun(
  selectedAnchor: EvidenceAnchor = anchor,
  selectedMedia: MediaAsset = media,
): AnalysisRunRecord {
  const run = queuedRun();

  return {
    ...run,
    requestedSnapshot: {
      ...run.requestedSnapshot,
      assetIds: [selectedMedia.id],
      evidenceIds: [selectedAnchor.id],
      observationIds: [observationId],
      checkIds: [checkId],
      frozenPack: {
        ...run.requestedSnapshot.frozenPack,
        media: [selectedMedia],
        evidence: [selectedAnchor],
        observations: [observation],
        checks: [check],
      },
    },
  };
}

function queuedRun(): AnalysisRunRecord {
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
    output: null,
    invocation: null,
    failureAudits: [],
    suggestedMethodVersions: [],
    status: 'queued',
  };
}

function fixture(
  options: {
    readonly job?: JobEnvelope | null;
    readonly run?: AnalysisRunRecord | null;
    readonly secondJob?: JobEnvelope | null;
    readonly secondRun?: AnalysisRunRecord | null;
    readonly statusUpdate?: boolean;
    readonly bind?: boolean;
    readonly jobUpdate?: boolean;
    readonly capability?: OperationResult<{
      readonly effectiveModelId: string;
      readonly capabilities: typeof capabilities;
    }>;
    readonly retrieval?: OperationResult<RetrievalSnapshot>;
    readonly model?: ModelOperationResult<AnalysisOutput>;
    readonly view?: CanonicalView | null;
    readonly source?: {
      readonly originalAssetId: string;
      readonly derivativeId: string | null;
      readonly storageKey: string;
      readonly mimeType: string;
    } | null;
    readonly derivatives?: ReadonlyMap<string, MediaDerivative>;
    readonly readMime?: string;
    readonly render?: OperationResult<Uint8Array>;
    readonly failStatusUpdate?: boolean;
    readonly failBindTransaction?: boolean;
    readonly auditAppend?: boolean;
  } = {},
) {
  const current: { job: JobEnvelope | null; run: AnalysisRunRecord | null } = {
    job: 'job' in options ? (options.job ?? null) : job,
    run: 'run' in options ? (options.run ?? null) : queuedRun(),
  };
  let jobReads = 0;
  let runReads = 0;
  const owners: string[] = [];
  const statusChanges: string[] = [];
  const saveOutput = vi.fn(async (_id: string, value: AnalysisOutput) => {
    if (current.run) {
      current.run = { ...current.run, output: value, status: 'completed' };
    }
  });
  const appendFailureAudit = vi.fn(
    async (_id: string, audit: AnalysisRunRecord['failureAudits'][number]) => {
      if (options.auditAppend === false || !current.run) {
        return false;
      }
      current.run = {
        ...current.run,
        failureAudits: [...current.run.failureAudits, audit],
      };

      return true;
    },
  );
  const setStatus = vi.fn(
    async (_id: string, _expected: readonly string[], status: string) => {
      if (
        options.statusUpdate === false ||
        (status === 'failed' && options.failStatusUpdate)
      ) {
        return false;
      }
      statusChanges.push(status);
      if (current.run) {
        current.run = {
          ...current.run,
          status: status as AnalysisRunRecord['status'],
        };
      }

      return true;
    },
  );
  const bindRetrievalSnapshot = vi.fn(
    async (
      _id: string,
      input: NonNullable<AnalysisRunRecord['input']>,
      snapshot: NonNullable<AnalysisRunRecord['retrievalSnapshot']>,
    ) => {
      if (options.bind === false) {
        return false;
      }
      if (current.run) {
        current.run = { ...current.run, input, retrievalSnapshot: snapshot };
      }

      return true;
    },
  );
  const updateJob = vi.fn(async (next: JobEnvelope) => {
    if (options.jobUpdate === false) {
      return false;
    }
    current.job = next;

    return true;
  });
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      owner: string,
      operation: (unit: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      owners.push(owner);
      if (options.failBindTransaction && owners.length === 2) {
        return {
          success: false,
          error: {
            code: 'JOB_FAILED',
            message: 'Database unavailable',
            retryable: true,
          },
        } as T;
      }
      const repositories = {
        jobs: {
          get: async () => {
            jobReads += 1;

            return jobReads === 2 && 'secondJob' in options
              ? (options.secondJob ?? null)
              : current.job;
          },
          update: updateJob,
        },
        analyses: {
          get: async () => {
            runReads += 1;

            return runReads === 2 && 'secondRun' in options
              ? (options.secondRun ?? null)
              : current.run;
          },
          setStatus,
          bindRetrievalSnapshot,
          appendFailureAudit,
          saveOutput,
        },
        media: {
          getCanonicalView: async () =>
            'view' in options
              ? (options.view ?? null)
              : (current.run?.requestedSnapshot.frozenPack.media[0]?.views[0] ??
                null),
          getCanonicalViewSource: async () =>
            'source' in options
              ? (options.source ?? null)
              : {
                  originalAssetId: assetId,
                  derivativeId: null,
                  storageKey: `originals/${assetId}`,
                  mimeType: 'image/jpeg',
                },
          getDerivative: async (id: string) =>
            options.derivatives?.get(id) ?? null,
        },
      };

      return operation(
        new Proxy({} as UnitOfWork, {
          get: (_target, key) =>
            key in repositories ? Reflect.get(repositories, key) : undefined,
        }),
      );
    },
  };
  const snapshot = {
    id: retrievalId,
    index,
    citations: [],
    text: [],
    methods: [],
    createdAt: now,
  };
  const text = {
    snapshot: vi.fn(
      async () =>
        options.retrieval ?? {
          success: true as const,
          data: snapshot,
        },
    ),
  };
  const model = {
    analyze: vi.fn(
      async () =>
        options.model ?? {
          success: true as const,
          data: { value: output, invocation },
        },
    ),
  };
  const catalog = {
    resolve: vi.fn(
      async () =>
        options.capability ?? {
          success: true as const,
          data: { effectiveModelId: selection.modelId, capabilities },
        },
    ),
  };
  const reader = {
    read: vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      mimeType: options.readMime ?? 'image/jpeg',
    })),
    renderRegion: vi.fn(
      async () =>
        options.render ?? { success: true as const, data: new Uint8Array([2]) },
    ),
  };
  const params: AnalysisHandlerParams = {
    transaction,
    text: {
      ...text,
      search: async () => ({
        success: true,
        data: { items: [], nextCursor: null },
      }),
    },
    index,
    model,
    catalog,
    media: reader,
    clock: { now: () => now },
  };

  return {
    handle: createAnalysisHandler(params),
    current,
    owners,
    statusChanges,
    setStatus,
    bindRetrievalSnapshot,
    updateJob,
    saveOutput,
    appendFailureAudit,
    text,
    model,
    catalog,
    reader,
  };
}

describe('fn:createAnalysisHandler', () => {
  it('should bind retrieval once, analyze a frozen run, and persist its completed job', async () => {
    const ports = fixture();

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.current.run).toMatchObject({ status: 'completed', output });
    expect(ports.current.job).toMatchObject({
      state: { kind: 'succeeded' },
      result: { runId },
    });
    expect(ports.statusChanges).toEqual(['running']);
    expect(ports.bindRetrievalSnapshot).toHaveBeenCalledTimes(1);
    expect(ports.text.snapshot).toHaveBeenCalledWith('Vase', index);
    expect(ports.model.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          recordId,
          snapshotId,
          retrievalSnapshotId: retrievalId,
        }),
        recordFields: expect.objectContaining({ name: 'Vase' }),
        images: [],
        citations: [],
        methods: [],
        text: [],
      }),
      selection,
    );
    expect(ports.owners).toEqual([ownerId, ownerId, ownerId, ownerId]);
  });

  it('should send frozen image and cited text to the model and persist selected methods', async () => {
    const ports = fixture({
      run: evidenceRun(),
      retrieval: {
        success: true,
        data: retrieved,
      },
      model: { success: true, data: { value: supportedOutput, invocation } },
    });

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.reader.read).toHaveBeenCalledWith(`originals/${assetId}`);
    expect(ports.reader.renderRegion).not.toHaveBeenCalled();
    expect(ports.model.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            evidenceId: anchorId,
            mediaType: 'image/jpeg',
            bytes: new Uint8Array([1]),
          },
        ],
        text: [
          { id: observationId, kind: 'observation', content: 'Blue glaze' },
          { id: checkId, kind: 'check', content: '{"kind":"present"}' },
          {
            kind: 'source',
            citationId: cropId,
            contentAsRetrieved: 'Blue glaze',
            sourceRegionId: null,
          },
        ],
        citations: [citation],
        methods: retrieved.methods,
      }),
      selection,
    );
    expect(ports.saveOutput).toHaveBeenCalledWith(
      runId,
      supportedOutput,
      [
        {
          methodId,
          methodVersionId,
          owningEntryId: recordId,
          titleZhHant: 'Examine glaze',
        },
      ],
      invocation,
      'completed',
    );
  });

  it('should reject missing or wrong-kind jobs and mark a failed run only when present', async () => {
    const missing = fixture({ job: null });
    expect(await missing.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', retryable: false },
    });
    expect(missing.statusChanges).toEqual([]);
    const wrong = fixture({ job: { ...job, kind: 'media' } });
    expect(await wrong.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(wrong.statusChanges).toEqual([]);
  });

  it('should decline a run already failed without invoking the model', async () => {
    const ports = fixture({ run: { ...queuedRun(), status: 'failed' } });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: false },
    });
    expect(ports.model.analyze).not.toHaveBeenCalled();
  });

  it('should retry a concurrent status transition without marking the run failed', async () => {
    const ports = fixture({ statusUpdate: false });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(ports.statusChanges).toEqual([]);
    expect(ports.model.analyze).not.toHaveBeenCalled();
  });

  it('should report a missing run without invoking the model', async () => {
    const ports = fixture({ run: null });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND', retryable: false },
    });
    expect(ports.model.analyze).not.toHaveBeenCalled();
  });

  it('should leave a run with persisted output untouched on replay', async () => {
    const ports = fixture({
      run: { ...queuedRun(), output, status: 'completed' },
    });

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.text.snapshot).not.toHaveBeenCalled();
    expect(ports.model.analyze).not.toHaveBeenCalled();
    expect(ports.updateJob).not.toHaveBeenCalled();
  });

  it('should pass through capability and retrieval failures before invoking the model', async () => {
    const capability = fixture({
      capability: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Model unavailable',
          retryable: true,
        },
      },
    });
    expect(await capability.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(capability.text.snapshot).not.toHaveBeenCalled();
    const retrieval = fixture({
      retrieval: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Index unavailable',
          retryable: true,
        },
      },
    });
    expect(await retrieval.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(retrieval.model.analyze).not.toHaveBeenCalled();
  });

  it('should retry a lost retrieval binding without running the model', async () => {
    const ports = fixture({ bind: false });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(ports.model.analyze).not.toHaveBeenCalled();
  });

  it('should pass through a failed retrieval-binding transaction', async () => {
    const ports = fixture({ failBindTransaction: true });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(ports.bindRetrievalSnapshot).not.toHaveBeenCalled();
    expect(ports.model.analyze).not.toHaveBeenCalled();
  });

  it('should reject invalid model output and mark the run failed', async () => {
    const rejectedOutput: AnalysisOutput = {
      ...output,
      findings: [
        {
          id: anchorId,
          kind: 'visualObservation',
          text: 'Unproven',
          evidenceIds: [],
          observationIds: [],
          citationIds: [],
          relation: 'supports',
          certainty: 'observed',
        },
      ],
    };
    const ports = fixture({
      model: {
        success: true,
        data: { value: rejectedOutput, invocation },
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID', retryable: false },
    });
    expect(ports.statusChanges).toEqual(['running', 'failed']);
    expect(ports.appendFailureAudit).toHaveBeenCalledWith(runId, {
      invocation: {
        ...invocation,
        citationCheck: {
          valid: false,
          rejectedReferenceIds: [anchorId],
        },
      },
      rawOutput: rejectedOutput,
    });
    expect(ports.current.run?.failureAudits).toHaveLength(1);
    expect(ports.saveOutput).not.toHaveBeenCalled();
  });

  it('should retry a model failure and preserve the running run for recovery', async () => {
    const ports = fixture({
      model: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Provider busy',
          retryable: true,
        },
        audit: failureAudit,
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(ports.statusChanges).toEqual(['running']);
    expect(ports.appendFailureAudit).toHaveBeenCalledWith(runId, failureAudit);
    expect(ports.current.run?.failureAudits).toEqual([failureAudit]);
    expect(ports.saveOutput).not.toHaveBeenCalled();
  });

  it('should persist a terminal provider failure audit before failing the run', async () => {
    const ports = fixture({
      model: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Provider rejected request',
          retryable: false,
        },
        audit: failureAudit,
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: false },
    });
    expect(ports.appendFailureAudit).toHaveBeenCalledWith(runId, failureAudit);
    expect(ports.current.run).toMatchObject({
      status: 'failed',
      failureAudits: [failureAudit],
      output: null,
    });
  });

  it('should retry when a provider failure audit cannot be appended', async () => {
    const ports = fixture({
      auditAppend: false,
      model: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Provider busy',
          retryable: false,
        },
        audit: failureAudit,
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(ports.current.run).toMatchObject({
      status: 'running',
      failureAudits: [],
      output: null,
    });
    expect(ports.statusChanges).toEqual(['running']);
  });

  it('should normalize an absent provider raw output before appending its audit', async () => {
    const ports = fixture({
      model: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Provider busy',
          retryable: true,
        },
        audit: { invocation: null, rawOutput: undefined },
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(ports.appendFailureAudit).toHaveBeenCalledWith(runId, {
      invocation: null,
      rawOutput: null,
    });
    expect(ports.current.run?.failureAudits).toEqual([
      { invocation: null, rawOutput: null },
    ]);
  });

  it('should leave a malformed or invalid-reference run running when audit append loses', async () => {
    const malformed: ModelOperationResult<AnalysisOutput> = {
      success: true,
      data: {
        value: { ...output, summary: 7 } as unknown as AnalysisOutput,
        invocation,
      },
    };
    const badReferences: ModelOperationResult<AnalysisOutput> = {
      success: true,
      data: {
        value: {
          ...output,
          findings: [
            {
              id: anchorId,
              kind: 'visualObservation',
              text: 'Unsupported',
              evidenceIds: [],
              observationIds: [],
              citationIds: [],
              relation: 'supports',
              certainty: 'observed',
            },
          ],
        },
        invocation,
      },
    };
    for (const model of [malformed, badReferences]) {
      const ports = fixture({ model, auditAppend: false });

      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'REVISION_CONFLICT', retryable: true },
      });
      expect(ports.appendFailureAudit).toHaveBeenCalledTimes(1);
      expect(ports.current.run).toMatchObject({
        status: 'running',
        output: null,
        failureAudits: [],
      });
      expect(ports.statusChanges).toEqual(['running']);
    }
  });

  it('should retain one failed invocation when a replay later succeeds', async () => {
    const failed: ModelOperationResult<AnalysisOutput> = {
      success: false,
      error: { code: 'JOB_FAILED', message: 'Provider busy', retryable: true },
      audit: failureAudit,
    };
    const ports = fixture();
    ports.model.analyze.mockResolvedValueOnce(failed);

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.appendFailureAudit).toHaveBeenCalledTimes(1);
    expect(ports.current.run).toMatchObject({
      status: 'completed',
      failureAudits: [failureAudit],
      output,
    });
  });

  it('should report a lost job or run before saving output', async () => {
    const missingJob = fixture({ secondJob: null });
    expect(await missingJob.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    const missingRun = fixture({ secondRun: null });
    expect(await missingRun.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('should leave a run completed concurrently untouched', async () => {
    const ports = fixture({
      secondRun: { ...queuedRun(), output, status: 'completed' },
    });

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.saveOutput).not.toHaveBeenCalled();
    expect(ports.updateJob).not.toHaveBeenCalled();
  });

  it('should retry a lost job completion revision', async () => {
    const ports = fixture({ jobUpdate: false });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
  });

  it('should reject frozen anchors absent from the snapshot or outside its geometry', async () => {
    const valid = evidenceRun();
    const unlisted = {
      ...valid,
      requestedSnapshot: {
        ...valid.requestedSnapshot,
        evidenceIds: [],
      },
    };
    const foreign = evidenceRun({ ...anchor, recordId: runId });
    const invalidRegion = evidenceRun({
      ...anchor,
      scope: {
        kind: 'region',
        region: { kind: 'rect', x: 0.8, y: 0, width: 0.4, height: 0.5 },
        cropDerivativeId: null,
      },
    });
    for (const run of [unlisted, foreign, invalidRegion]) {
      const ports = fixture({ run });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID', retryable: false },
      });
      expect(ports.model.analyze).not.toHaveBeenCalled();
    }
  });

  it('should reject frozen media outside the authorized ready object record', async () => {
    const valid = evidenceRun();
    const cases = [
      {
        ...valid,
        requestedSnapshot: {
          ...valid.requestedSnapshot,
          frozenPack: { ...valid.requestedSnapshot.frozenPack, media: [] },
        },
      },
      {
        ...valid,
        requestedSnapshot: { ...valid.requestedSnapshot, assetIds: [] },
      },
      evidenceRun(anchor, { ...media, state: 'uploaded' }),
      evidenceRun(anchor, { ...media, purpose: 'receipt' }),
      evidenceRun(anchor, {
        ...media,
        owner: { kind: 'source_intake' as const, intakeKey: recordId },
      }),
      evidenceRun(anchor, {
        ...media,
        owner: { kind: 'record' as const, recordId: runId },
      }),
    ];
    for (const run of cases) {
      const ports = fixture({ run });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(ports.reader.read).not.toHaveBeenCalled();
    }
  });

  it('should reject a frozen view missing from its original or pointing elsewhere', async () => {
    const missing = evidenceRun(anchor, { ...media, views: [] });
    const misplaced = evidenceRun(anchor, {
      ...media,
      views: [
        {
          ...media.views[0]!,
          originalAssetId: runId,
        },
      ],
    });
    for (const run of [missing, misplaced]) {
      const ports = fixture({ run });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
    }
  });

  it('should reject stale persisted view locators before reading original bytes', async () => {
    const view = media.views[0]!;
    const source = {
      originalAssetId: assetId,
      derivativeId: null,
      storageKey: `originals/${assetId}`,
      mimeType: 'image/jpeg',
    };
    for (const options of [
      { view: null },
      { view: { ...view, width: 11 } },
      { source: null },
      { source: { ...source, originalAssetId: runId } },
      { source: { ...source, derivativeId } },
    ]) {
      const ports = fixture({ run: evidenceRun(), ...options });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(ports.reader.read).not.toHaveBeenCalled();
    }
  });

  it('should reject an evidence kind whose frozen media or coordinate space disagrees', async () => {
    const view = media.views[0]!;
    const video = { ...media, kind: 'video' as const };
    const videoFrame = {
      streamIndex: 0,
      timeBase: { numerator: 1, denominator: 1000 },
      pts: '10',
      frameDerivativeId: derivativeId,
      displayTimeMs: 10,
    };
    const cases = [
      { run: evidenceRun(anchor, video) },
      {
        run: evidenceRun(anchor, {
          ...media,
          views: [{ ...view, originalCoordinateSpace: 'video_frame_pixels' }],
        }),
      },
      {
        run: evidenceRun(
          { ...anchor, kind: 'video_frame', frame: videoFrame },
          media,
        ),
      },
      {
        run: evidenceRun(
          { ...anchor, kind: 'video_frame', frame: videoFrame },
          {
            ...video,
            views: [{ ...view, originalCoordinateSpace: 'image_pixels' }],
          },
        ),
      },
      {
        run: evidenceRun(
          { ...anchor, kind: 'video_frame', frame: videoFrame },
          {
            ...video,
            views: [
              {
                ...view,
                originalCoordinateSpace: 'video_frame_pixels',
                derivativeId: cropId,
              },
            ],
          },
        ),
      },
    ];
    for (const { run } of cases) {
      const ports = fixture({ run });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
    }
  });

  it('should use a persisted canonical derivative only when its provenance matches', async () => {
    const view = { ...media.views[0]!, derivativeId };
    const run = evidenceRun(anchor, { ...media, views: [view] });
    const source = {
      originalAssetId: assetId,
      derivativeId,
      storageKey: derivative.storageKey,
      mimeType: derivative.mimeType,
    };
    const accepted = fixture({
      run,
      source,
      derivatives: new Map([[derivativeId, derivative]]),
    });

    expect(await accepted.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(accepted.reader.read).toHaveBeenCalledWith(derivative.storageKey);
    expect(accepted.model.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            evidenceId: anchorId,
            mediaType: 'image/jpeg',
            bytes: new Uint8Array([1]),
          },
        ],
      }),
      selection,
    );

    for (const candidate of [
      null,
      { ...derivative, originalAssetId: runId },
      { ...derivative, storageKey: 'other' },
      { ...derivative, mimeType: 'image/png' },
      { ...derivative, kind: 'crop' as const },
    ]) {
      const ports = fixture({
        run,
        source,
        derivatives: candidate
          ? new Map([[derivativeId, candidate]])
          : new Map(),
      });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(ports.reader.read).not.toHaveBeenCalled();
    }
  });

  it('should require a matching frame derivative for video evidence', async () => {
    const frame = {
      streamIndex: 0,
      timeBase: { numerator: 1, denominator: 1000 },
      pts: '10',
      frameDerivativeId: derivativeId,
      displayTimeMs: 10,
    };
    const frameAnchor: EvidenceAnchor = {
      ...anchor,
      kind: 'video_frame',
      frame,
    };
    const view = {
      ...media.views[0]!,
      derivativeId,
      originalCoordinateSpace: 'video_frame_pixels' as const,
    };
    const run = evidenceRun(frameAnchor, {
      ...media,
      kind: 'video',
      views: [view],
    });
    const source = {
      originalAssetId: assetId,
      derivativeId,
      storageKey: derivative.storageKey,
      mimeType: derivative.mimeType,
    };
    const frameDerivative: MediaDerivative = {
      ...derivative,
      kind: 'frame',
      frame,
    };
    const accepted = fixture({
      run,
      source,
      derivatives: new Map([[derivativeId, frameDerivative]]),
    });

    expect(await accepted.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(accepted.reader.read).toHaveBeenCalledWith(derivative.storageKey);

    for (const candidate of [
      { ...frameDerivative, kind: 'canonical' as const },
      { ...frameDerivative, frame: { ...frame, pts: '11' } },
    ]) {
      const ports = fixture({
        run,
        source,
        derivatives: new Map([[derivativeId, candidate]]),
      });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
    }
  });

  it('should render a selected region and report a render failure', async () => {
    const region = {
      kind: 'rect' as const,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    };
    const regionAnchor: EvidenceAnchor = {
      ...anchor,
      scope: { kind: 'region', region, cropDerivativeId: null },
    };
    const run = evidenceRun(regionAnchor);
    const accepted = fixture({ run });

    expect(await accepted.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(accepted.reader.renderRegion).toHaveBeenCalledWith({
      originalAssetId: assetId,
      canonicalViewId: viewId,
      bytes: new Uint8Array([1]),
      region,
    });
    expect(accepted.model.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        images: [
          {
            evidenceId: anchorId,
            mediaType: 'image/png',
            bytes: new Uint8Array([2]),
          },
        ],
      }),
      selection,
    );

    const failed = fixture({
      run,
      render: {
        success: false,
        error: {
          code: 'JOB_FAILED',
          message: 'Renderer unavailable',
          retryable: true,
        },
      },
    });
    expect(await failed.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'JOB_FAILED', retryable: true },
    });
    expect(failed.model.analyze).not.toHaveBeenCalled();
  });

  it('should use only a crop whose parent and region match the frozen anchor', async () => {
    const region = {
      kind: 'rect' as const,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    };
    const cropAnchor: EvidenceAnchor = {
      ...anchor,
      scope: { kind: 'region', region, cropDerivativeId: cropId },
    };
    const run = evidenceRun(cropAnchor);
    const crop: MediaDerivative = {
      ...derivative,
      id: cropId,
      kind: 'crop',
      parentDerivativeId: null,
      region,
      storageKey: `derivatives/${cropId}`,
      mimeType: 'image/png',
    };
    const accepted = fixture({
      run,
      derivatives: new Map([[cropId, crop]]),
      readMime: 'image/png',
    });

    expect(await accepted.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(accepted.reader.read).toHaveBeenCalledWith(crop.storageKey);
    expect(accepted.reader.renderRegion).not.toHaveBeenCalled();

    for (const candidate of [
      null,
      { ...crop, kind: 'canonical' as const },
      { ...crop, originalAssetId: runId },
      { ...crop, parentDerivativeId: derivativeId },
      { ...crop, region: { ...region, x: 0.2 } },
    ]) {
      const ports = fixture({
        run,
        derivatives: candidate ? new Map([[cropId, candidate]]) : new Map(),
      });
      expect(await ports.handle(ownerId, jobId)).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(ports.reader.read).not.toHaveBeenCalled();
    }
  });

  it('should reject unsupported or changed image media types before model execution', async () => {
    const unsupported = fixture({
      run: evidenceRun(),
      source: {
        originalAssetId: assetId,
        derivativeId: null,
        storageKey: `originals/${assetId}`,
        mimeType: 'image/gif',
      },
    });
    expect(await unsupported.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID' },
    });
    expect(unsupported.reader.read).not.toHaveBeenCalled();

    const changed = fixture({ run: evidenceRun(), readMime: 'image/png' });
    expect(await changed.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'EVIDENCE_INVALID' },
    });
    expect(changed.reader.read).toHaveBeenCalledTimes(1);
    expect(changed.model.analyze).not.toHaveBeenCalled();
  });

  it('should reuse a bound input and retrieval snapshot during replay', async () => {
    const run = queuedRun();
    const bound = {
      ...run,
      status: 'running' as const,
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
        retrievalSnapshotId: retrievalId,
        promptVersion: 'analysis-prompt-v1',
        schemaVersion: 'analysis-output-v1',
      },
      retrievalSnapshot: retrieved,
    };
    const ports = fixture({ run: bound });

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.text.snapshot).not.toHaveBeenCalled();
    expect(ports.bindRetrievalSnapshot).not.toHaveBeenCalled();
    expect(ports.model.analyze).toHaveBeenCalledWith(
      expect.objectContaining({
        input: bound.input,
        citations: retrieved.citations,
      }),
      selection,
    );
  });

  it('should omit an unnamed record from the retrieval query', async () => {
    const run = queuedRun();
    const ports = fixture({
      run: {
        ...run,
        requestedSnapshot: {
          ...run.requestedSnapshot,
          frozenPack: {
            ...run.requestedSnapshot.frozenPack,
            recordFields: {
              ...run.requestedSnapshot.frozenPack.recordFields,
              name: null,
              description: 'Blue glazed vase',
            },
          },
        },
      },
    });

    expect(await ports.handle(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.text.snapshot).toHaveBeenCalledWith('Blue glazed vase', index);
  });

  it('should reject malformed model output before saving it', async () => {
    const malformed = { ...output, summary: 7 };
    const ports = fixture({
      model: {
        success: true,
        data: {
          value: malformed as unknown as AnalysisOutput,
          invocation,
        },
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED', retryable: false },
    });
    expect(ports.statusChanges).toEqual(['running', 'failed']);
    expect(ports.appendFailureAudit).toHaveBeenCalledWith(runId, {
      invocation,
      rawOutput: malformed,
    });
    expect(ports.current.run?.failureAudits).toHaveLength(1);
    expect(ports.saveOutput).not.toHaveBeenCalled();
  });

  it('should retry when a failed run cannot persist its terminal status', async () => {
    const ports = fixture({
      failStatusUpdate: true,
      model: {
        success: true,
        data: {
          value: { ...output, suggestedMethodIds: [methodId] },
          invocation,
        },
      },
    });

    expect(await ports.handle(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT', retryable: true },
    });
    expect(ports.statusChanges).toEqual(['running']);
  });
});
