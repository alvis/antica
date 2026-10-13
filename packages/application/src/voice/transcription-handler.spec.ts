import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { createTranscriptionHandler } from './transcription-handler.js';

import type {
  JobEnvelope,
  MediaAsset,
  ModelInvocation,
  TranscriptionResult,
} from '@antica/contracts';

import type {
  ModelCatalogPort,
  OperationResult,
  TranscriptionPort,
  TranscriptionRunRecord,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const audioId = '00000000-0000-4000-8000-000000000003';
const transcriptionId = '00000000-0000-4000-8000-000000000004';
const jobId = '00000000-0000-4000-8000-000000000005';
const now = '2026-10-13T12:00:00.000Z';
const bytes = new Uint8Array([1, 2, 3, 4]);
const sha256 = createHash('sha256').update(bytes).digest('hex');
const result: TranscriptionResult = {
  transcriptionId,
  recordId,
  audioAssetId: audioId,
  originalText: 'old vase',
  readingTextZhHant: '古瓶',
  detectedLanguages: ['en'],
  uncertainTerms: [],
  segments: [],
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
    audioInput: true,
    structuredOutput: true,
    toolCalling: false,
  },
  role: 'transcription',
  profileVersion: '1',
  promptVersion: '1',
  schemaVersion: '1',
  effectiveOptions: {},
  latencyMs: 1,
  usage: { inputTokens: null, outputTokens: null },
  finishReason: null,
  citationCheck: { valid: true, rejectedReferenceIds: [] },
};

function pendingRun(): TranscriptionRunRecord {
  return {
    detail: {
      transcriptionId,
      jobId,
      revision: 1,
      status: 'pending',
      snapshot: {
        recordId,
        recordRevision: 1,
        audioAssetId: audioId,
        audioSha256: sha256,
        createdAt: now,
      },
      result: null,
      invocation: null,
      confirmedObservationId: null,
      createdAt: now,
      updatedAt: now,
    },
    request: {
      requestKey: transcriptionId,
      recordId,
      audioAssetId: audioId,
      expectedRecordRevision: 1,
      vocabularyHints: ['celadon'],
    },
    modelSelection: {
      role: 'transcription',
      modelId: 'development',
      profileVersion: '1',
    },
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
    byteLength: bytes.length,
    sha256,
    durationMs: 500,
    views: [],
    createdAt: now,
  };
}

function job(): JobEnvelope {
  return {
    id: jobId,
    kind: 'transcription',
    resourceId: transcriptionId,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: null,
  };
}

function fixture(
  options: {
    readonly run?: TranscriptionRunRecord | null;
    readonly asset?: MediaAsset | null;
    readonly job?: JobEnvelope | null;
    readonly read?: { readonly bytes: Uint8Array; readonly mimeType: string };
    readonly output?: TranscriptionResult;
    readonly capabilityFailure?: boolean;
    readonly modelFailure?: boolean;
    readonly saveResult?: boolean;
    readonly updateJob?: boolean;
    readonly afterModel?: 'run_missing' | 'job_missing' | 'already_saved';
  } = {},
) {
  const current = {
    run: 'run' in options ? (options.run ?? null) : pendingRun(),
    job: 'job' in options ? (options.job ?? null) : job(),
  };
  const saveResult = vi.fn(async () => {
    if (options.saveResult === false) {
      return false;
    }
    if (current.run) {
      current.run = {
        ...current.run,
        detail: {
          ...current.run.detail,
          result: options.output ?? result,
          status: 'ready',
          revision: 2,
        },
      };
    }

    return true;
  });
  const updateJob = vi.fn(async () => options.updateJob !== false);
  const repositories = {
    jobs: { get: vi.fn(async () => current.job), update: updateJob },
    transcriptions: { get: vi.fn(async () => current.run), saveResult },
    media: {
      get: vi.fn(async () =>
        'asset' in options ? (options.asset ?? null) : audio(),
      ),
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
  const transcribe = vi.fn(async () => {
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
          data: { value: options.output ?? result, invocation },
        };
  });
  const model: TranscriptionPort = { transcribe };
  const read = vi.fn(
    async () => options.read ?? { bytes, mimeType: 'audio/mp4' },
  );
  const handler = createTranscriptionHandler(
    transaction,
    model,
    catalog,
    { read },
    { now: () => now },
  );

  return {
    handler,
    current,
    repositories,
    catalog,
    transcribe,
    read,
    saveResult,
    updateJob,
  };
}

describe('fn:createTranscriptionHandler', () => {
  it('should read frozen audio, validate generated text, and save it without adoption', async () => {
    const ports = fixture();
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.read).toHaveBeenCalledWith(`originals/${audioId}`);
    expect(ports.transcribe).toHaveBeenCalledWith(
      ports.current.run?.request,
      { bytes, mimeType: 'audio/mp4' },
      ports.current.run?.modelSelection,
    );
    expect(ports.current.run?.detail).toMatchObject({
      status: 'ready',
      result,
      confirmedObservationId: null,
    });
    expect(ports.updateJob).toHaveBeenCalledWith(
      expect.objectContaining({
        state: { kind: 'succeeded', completedAt: now },
        result: { transcriptionId },
      }),
      now,
    );
    expect(await ports.handler(ownerId, jobId)).toEqual({
      success: true,
      data: undefined,
    });
    expect(ports.transcribe).toHaveBeenCalledTimes(1);
  });

  it('should reject missing jobs, runs, and changed frozen media before model execution', async () => {
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
      await fixture({ asset: null }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ asset: { ...audio(), sha256: 'b'.repeat(64) } }).handler(
        ownerId,
        jobId,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ asset: { ...audio(), state: 'processing' } }).handler(
        ownerId,
        jobId,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
  });

  it('should stop on model capability, changed bytes, model failure, or invalid output', async () => {
    expect(
      await fixture({ capabilityFailure: true }).handler(ownerId, jobId),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      await fixture({
        read: { bytes: new Uint8Array([9]), mimeType: 'audio/mp4' },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ read: { bytes, mimeType: 'audio/wav' } }).handler(
        ownerId,
        jobId,
      ),
    ).toMatchObject({ success: false, error: { code: 'EVIDENCE_INVALID' } });
    expect(
      await fixture({ modelFailure: true }).handler(ownerId, jobId),
    ).toMatchObject({
      success: false,
      error: { code: 'PROVIDER_UNAVAILABLE' },
    });
    expect(
      await fixture({
        output: {
          ...result,
          transcriptionId: '00000000-0000-4000-8000-000000000099',
        },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await fixture({
        output: {
          ...result,
          segments: [{ id: 'bad-id', startMs: 0, endMs: 1, originalText: 'x' }],
        },
      }).handler(ownerId, jobId),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should report compare-and-swap failures without recording a successful job', async () => {
    const changedRun = fixture({ saveResult: false });
    expect(await changedRun.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(changedRun.updateJob).not.toHaveBeenCalled();
    const changedJob = fixture({ updateJob: false });
    expect(await changedJob.handler(ownerId, jobId)).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
  });

  it('should resolve a disappeared job or concurrent saved result after model work', async () => {
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
  });
});
