import { describe, expect, it, vi } from 'vitest';

import { OriginalVerificationError } from '../ports/index.js';

import { createMediaService } from './media.js';

import type {
  MediaAsset,
  RecordDetail,
  UploadRequest,
  UploadSession,
} from '@antica/contracts';

import type {
  CommandReceipt,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

import type { MediaStoragePort } from './media.js';

const ownerId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000003';
const now = '2026-10-13T12:00:00.000Z';
const request: UploadRequest = {
  requestKey: '00000000-0000-4000-8000-000000000004',
  target: { kind: 'record', recordId },
  kind: 'photo',
  purpose: 'object',
  componentIds: [],
  fileName: 'vase.jpg',
  mimeType: 'image/jpeg',
  byteLength: 4,
  sha256: 'a'.repeat(64),
};
const singleSession = {
  assetId,
  mode: 'single',
  putUrl: 'https://upload.example/asset',
  headers: { 'content-type': 'image/jpeg' },
  expiresAt: now,
} satisfies UploadSession;
const multipartSession = {
  assetId,
  mode: 'multipart',
  uploadId: 'upload-1',
  parts: [
    {
      partNumber: 1,
      offset: 0,
      byteLength: 64 * 1024 * 1024,
      putUrl: 'https://upload.example/part',
      headers: {},
    },
  ],
  expiresAt: now,
} satisfies UploadSession;

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
    mediaIds: [assetId],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

function asset(state: MediaAsset['state'] = 'awaiting_upload'): MediaAsset {
  return {
    id: assetId,
    owner: { kind: 'record', recordId },
    kind: 'photo',
    purpose: 'object',
    state,
    componentIds: [],
    originalFileName: 'vase.jpg',
    mimeType: 'image/jpeg',
    byteLength: 4,
    sha256: 'a'.repeat(64),
    durationMs: null,
    views: [],
    createdAt: now,
  };
}

function fixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly asset?: MediaAsset | null;
    readonly session?: UploadSession | null;
    readonly priorSession?: UploadSession | null;
    readonly createError?: Error;
    readonly verifyError?: Error;
    readonly completeMultipartError?: Error;
    readonly multipart?: boolean;
    readonly abort?: boolean;
    readonly completeMultipart?: boolean;
    readonly resume?: Awaited<
      ReturnType<NonNullable<MediaStoragePort['resumeMultipart']>>
    >;
    readonly job?: { readonly id: string } | null;
  } = {},
) {
  const receipts = new Map<string, CommandReceipt>();
  const current = {
    asset: 'asset' in options ? (options.asset ?? null) : asset(),
    session: 'session' in options ? (options.session ?? null) : singleSession,
  };
  const createUpload = vi.fn(
    async (_request: UploadRequest, session: UploadSession) => {
      if (options.createError) {
        throw options.createError;
      }
      current.session = session;
    },
  );
  const complete = vi.fn(async () => {
    if (current.asset) {
      current.asset = { ...current.asset, state: 'uploaded' };
    }
  });
  const createJob = vi.fn(async () => undefined);
  const enqueue = vi.fn(async () => undefined);
  const signUpload = vi.fn(async () => ({
    url: singleSession.putUrl,
    expiresAt: now,
    headers: singleSession.headers,
  }));
  const startMultipart = vi.fn(async () => ({
    uploadId: multipartSession.uploadId,
    expiresAt: now,
    parts: multipartSession.parts,
  }));
  const abortMultipart = vi.fn(async () => undefined);
  const completeMultipart = vi.fn(async () => {
    if (options.completeMultipartError) {
      throw options.completeMultipartError;
    }
  });
  const resumeMultipart = vi.fn<
    NonNullable<MediaStoragePort['resumeMultipart']>
  >(async () => options.resume ?? { state: 'expired' });
  const verifyOriginal = vi.fn(async () => {
    if (options.verifyError) {
      throw options.verifyError;
    }
  });
  const signRead = vi.fn(async (key: string) => ({
    url: `https://read.example/${key}`,
    expiresAt: now,
  }));
  const storage: MediaStoragePort = {
    signUpload,
    verifyOriginal,
    signRead,
    ...(options.multipart ? { startMultipart } : {}),
    ...(options.abort ? { abortMultipart } : {}),
    ...(options.completeMultipart ? { completeMultipart } : {}),
    ...(options.resume ? { resumeMultipart } : {}),
  };
  const repositories = {
    records: {
      get: vi.fn(async () =>
        'record' in options ? (options.record ?? null) : record(),
      ),
    },
    commands: {
      get: vi.fn(
        async (_owner: string, operation: string, key: string) =>
          receipts.get(`${operation}:${key}`) ?? null,
      ),
      insert: vi.fn(async (receipt: CommandReceipt) => {
        receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
      }),
    },
    media: {
      get: vi.fn(async () => current.asset),
      getUploadByRequestKey: vi.fn(async () => options.priorSession ?? null),
      getUploadSession: vi.fn(async () => current.session),
      createUpload,
      complete,
    },
    jobs: {
      create: createJob,
      getByResource: vi.fn(async () => options.job ?? null),
    },
    outbox: { enqueue },
    evidence: { queryAnchorsByAsset: vi.fn(async () => []) },
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
  const ids = { create: vi.fn(() => assetId) };
  const service = createMediaService(
    transaction,
    storage,
    { now: () => now },
    ids,
  );

  return {
    service,
    current,
    receipts,
    repositories,
    ids,
    signUpload,
    startMultipart,
    abortMultipart,
    completeMultipart,
    resumeMultipart,
    verifyOriginal,
    signRead,
    createUpload,
    complete,
    createJob,
    enqueue,
  };
}

describe('fn:createMediaService', () => {
  it('should sign a private original once and replay its persisted upload session', async () => {
    const ports = fixture();
    const first = await ports.service.start(ownerId, request);
    const replay = await ports.service.start(ownerId, request);

    expect(first).toEqual({ success: true, data: singleSession });
    expect(replay).toEqual(first);
    expect(ports.signUpload).toHaveBeenCalledTimes(1);
    expect(ports.createUpload).toHaveBeenCalledWith(request, singleSession);
    expect(
      ports.receipts.get(`media.start:${request.requestKey}`),
    ).toMatchObject({ status: 201 });
  });

  it('should reject a missing target record and a reused key with a different request', async () => {
    const missing = fixture({ record: null });
    expect(await missing.service.start(ownerId, request)).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(missing.signUpload).not.toHaveBeenCalled();
    const ports = fixture();
    await ports.service.start(ownerId, request);
    expect(
      await ports.service.start(ownerId, {
        ...request,
        fileName: 'different.jpg',
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(ports.signUpload).toHaveBeenCalledTimes(1);
  });

  it('should create and complete multipart signing while preserving the declared parts', async () => {
    const ports = fixture({
      multipart: true,
      completeMultipart: true,
      session: multipartSession,
    });
    const large = { ...request, byteLength: 64 * 1024 * 1024 };
    expect(await ports.service.start(ownerId, large)).toEqual({
      success: true,
      data: multipartSession,
    });
    expect(ports.startMultipart).toHaveBeenCalledTimes(1);
    expect(ports.signUpload).not.toHaveBeenCalled();
    const parts = [{ partNumber: 1, etag: 'etag-1' }];
    expect(
      await ports.service.complete(ownerId, assetId, 'complete-1', parts),
    ).toMatchObject({ success: true, data: { assetId, state: 'uploaded' } });
    expect(ports.completeMultipart).toHaveBeenCalledWith(
      expect.objectContaining({ assetId }),
      { uploadId: 'upload-1', layout: multipartSession.parts },
      parts,
    );
    expect(ports.verifyOriginal).toHaveBeenCalledTimes(1);
  });

  it('should abort a losing multipart start or a failed persistent write', async () => {
    const large = { ...request, byteLength: 64 * 1024 * 1024 };
    const otherSession = {
      ...singleSession,
      assetId: '00000000-0000-4000-8000-000000000099',
    };
    const raced = fixture({
      multipart: true,
      abort: true,
      priorSession: otherSession,
    });
    expect(await raced.service.start(ownerId, large)).toEqual({
      success: true,
      data: otherSession,
    });
    expect(raced.abortMultipart).toHaveBeenCalledTimes(1);
    expect(raced.createUpload).not.toHaveBeenCalled();
    const failure = new Error('database unavailable');
    const broken = fixture({
      multipart: true,
      abort: true,
      createError: failure,
    });
    await expect(broken.service.start(ownerId, large)).rejects.toBe(failure);
    expect(broken.abortMultipart).toHaveBeenCalledTimes(1);
    const noAbort = fixture({ multipart: true, createError: failure });
    await expect(noAbort.service.start(ownerId, large)).rejects.toBe(failure);
    expect(noAbort.abortMultipart).not.toHaveBeenCalled();
    const single = fixture({ createError: failure });
    await expect(single.service.start(ownerId, request)).rejects.toBe(failure);
  });

  it('should reject incomplete uploads and invalid multipart part lists', async () => {
    expect(
      await fixture({ asset: null }).service.complete(
        ownerId,
        assetId,
        'complete-1',
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture({ session: null }).service.complete(
        ownerId,
        assetId,
        'complete-1',
      ),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture().service.complete(ownerId, assetId, 'complete-1', [
        { partNumber: 1, etag: 'etag' },
      ]),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const multipart = fixture({ session: multipartSession, multipart: true });
    expect(
      await multipart.service.complete(ownerId, assetId, 'complete-1'),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await multipart.service.complete(ownerId, assetId, 'complete-1', []),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await multipart.service.complete(ownerId, assetId, 'complete-1', [
        { partNumber: 2, etag: 'etag' },
      ]),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(
      await multipart.service.complete(ownerId, assetId, 'complete-1', [
        { partNumber: 1, etag: 'etag' },
      ]),
    ).toMatchObject({ success: false, error: { code: 'MEDIA_UNSUPPORTED' } });
  });

  it('should confirm a verified single upload exactly once and queue processing', async () => {
    const ports = fixture();
    const first = await ports.service.complete(ownerId, assetId, 'complete-1');
    const replay = await ports.service.complete(ownerId, assetId, 'complete-1');

    expect(first).toMatchObject({
      success: true,
      data: { assetId, state: 'uploaded' },
    });
    expect(replay).toEqual(first);
    expect(ports.verifyOriginal).toHaveBeenCalledTimes(1);
    expect(ports.complete).toHaveBeenCalledTimes(1);
    expect(ports.createJob).toHaveBeenCalledTimes(1);
    expect(ports.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'antica.media.uploaded' }),
    );
  });

  it('should reject a changed multipart completion key and storage state races', async () => {
    const parts = [{ partNumber: 1, etag: 'etag-1' }];
    const multipart = fixture({
      session: multipartSession,
      completeMultipart: true,
    });
    await multipart.service.complete(ownerId, assetId, 'complete-1', parts);
    expect(
      await multipart.service.complete(ownerId, assetId, 'complete-1', [
        { partNumber: 1, etag: 'etag-2' },
      ]),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const deleted = fixture();
    deleted.repositories.media.get
      .mockResolvedValueOnce(asset())
      .mockResolvedValueOnce(null);
    expect(
      await deleted.service.complete(ownerId, assetId, 'complete-1'),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    const alreadyCompleted = fixture();
    alreadyCompleted.repositories.media.get
      .mockResolvedValueOnce(asset())
      .mockResolvedValueOnce(asset('uploaded'));
    expect(
      await alreadyCompleted.service.complete(ownerId, assetId, 'complete-1'),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
  });

  it('should recover from an interrupted multipart completion only when the original verifies', async () => {
    const ports = fixture({
      session: multipartSession,
      completeMultipart: true,
      completeMultipartError: new Error('upload already finalized'),
    });
    expect(
      await ports.service.complete(ownerId, assetId, 'complete-1', [
        { partNumber: 1, etag: 'etag-1' },
      ]),
    ).toMatchObject({ success: true, data: { state: 'uploaded' } });
    expect(ports.verifyOriginal).toHaveBeenCalledTimes(2);
  });

  it('should reject failed verification and reused completion keys without creating another job', async () => {
    const broken = fixture({ verifyError: new Error('missing original') });
    expect(
      await broken.service.complete(ownerId, assetId, 'complete-1'),
    ).toMatchObject({
      success: false,
      error: { code: 'UPLOAD_INCOMPLETE', retryable: true },
    });
    expect(broken.createJob).not.toHaveBeenCalled();
    const ports = fixture();
    await ports.service.complete(ownerId, assetId, 'complete-1');
    expect(
      await ports.service.complete(ownerId, assetId, 'complete-1', []),
    ).toEqual({
      success: true,
      data: { assetId, state: 'uploaded', processingJobId: assetId },
    });
    expect(ports.createJob).toHaveBeenCalledTimes(1);
  });

  it.for(['absent', 'mismatch'] as const)(
    'should reject completion when original verification reports %s',
    async (reason) => {
      const cause = new OriginalVerificationError({
        reason,
        message: 'Original cannot be verified',
      });
      const ports = fixture({ verifyError: cause });

      expect(
        await ports.service.complete(ownerId, assetId, 'complete-1'),
      ).toMatchObject({
        success: false,
        error: { code: 'UPLOAD_INCOMPLETE', retryable: true },
        cause,
      });
      expect(ports.complete).not.toHaveBeenCalled();
      expect(ports.createJob).not.toHaveBeenCalled();
      expect(ports.enqueue).not.toHaveBeenCalled();
      expect(ports.current.asset).toEqual(asset());
    },
  );

  it('should sign read access only for uploaded originals and their derivatives', async () => {
    const waiting = fixture();
    expect(await waiting.service.get(ownerId, assetId)).toMatchObject({
      success: true,
      data: { reads: [], versions: { recordRevision: 1 } },
    });
    expect(waiting.signRead).not.toHaveBeenCalled();
    const ready = fixture({
      asset: {
        ...asset('ready'),
        views: [
          {
            id: '00000000-0000-4000-8000-000000000009',
            originalAssetId: assetId,
            derivativeId: null,
            width: 10,
            height: 10,
            originalCoordinateSpace: 'image_pixels',
            transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
          {
            id: '00000000-0000-4000-8000-000000000010',
            originalAssetId: assetId,
            derivativeId: '00000000-0000-4000-8000-000000000011',
            width: 10,
            height: 10,
            originalCoordinateSpace: 'image_pixels',
            transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
          },
        ],
      },
      job: { id: 'job-1' },
    });
    expect(await ready.service.get(ownerId, assetId)).toMatchObject({
      success: true,
      data: {
        processingJobId: 'job-1',
        reads: [
          {
            assetOrDerivativeId: assetId,
            url: `https://read.example/originals/${assetId}`,
          },
          { assetOrDerivativeId: '00000000-0000-4000-8000-000000000011' },
        ],
      },
    });
    expect(ready.signRead).toHaveBeenCalledTimes(2);
    const intake = fixture({
      asset: {
        ...asset('ready'),
        owner: {
          kind: 'source_intake',
          intakeKey: '00000000-0000-4000-8000-000000000012',
        },
      },
      record: null,
    });
    expect(await intake.service.get(ownerId, assetId)).toMatchObject({
      success: true,
      data: { versions: null, processingJobId: null },
    });
    expect(intake.repositories.records.get).not.toHaveBeenCalled();
    expect(
      await fixture({ asset: null }).service.get(ownerId, assetId),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  describe('mt:resume', () => {
    const later = '2026-10-13T12:15:00.000Z';
    const missing = new OriginalVerificationError({
      reason: 'absent',
      message: 'Original is absent',
    });

    it.for([singleSession, multipartSession])(
      'should return a retryable verification failure when resuming a $mode upload',
      async (session) => {
        const cause = new Error('storage temporarily unavailable');
        const ports = fixture({
          session,
          resume: { state: 'expired' },
          verifyError: cause,
        });

        expect(await ports.service.resume(ownerId, assetId)).toMatchObject({
          success: false,
          error: { code: 'UPLOAD_INCOMPLETE', retryable: true },
          cause,
        });
        expect(ports.signUpload).not.toHaveBeenCalled();
        expect(ports.createUpload).not.toHaveBeenCalled();
        expect(ports.current.asset).toEqual(asset());
        expect(ports.receipts.size).toBe(0);
      },
    );

    it('should re-sign a pending single upload whose bytes have not landed', async () => {
      const ports = fixture({ verifyError: missing });
      ports.signUpload.mockResolvedValueOnce({
        url: 'https://upload.example/fresh',
        expiresAt: later,
        headers: singleSession.headers,
      });

      expect(await ports.service.resume(ownerId, assetId)).toEqual({
        success: true,
        data: {
          assetId,
          mode: 'single',
          putUrl: 'https://upload.example/fresh',
          headers: singleSession.headers,
          expiresAt: later,
          uploadedParts: [],
        },
      });
      expect(ports.signUpload).toHaveBeenCalledWith({
        assetId,
        key: `originals/${assetId}`,
        mimeType: 'image/jpeg',
        byteLength: 4,
        sha256: 'a'.repeat(64),
      });
      expect(ports.createUpload).not.toHaveBeenCalled();
      expect(ports.receipts.size).toBe(0);
    });

    it('should tell the client to complete a single upload whose bytes already landed, then complete it once', async () => {
      const ports = fixture();

      expect(await ports.service.resume(ownerId, assetId)).toEqual({
        success: false,
        error: {
          code: 'UPLOAD_STORED',
          message: 'The file is already stored; complete the upload.',
          retryable: false,
        },
      });
      expect(ports.signUpload).not.toHaveBeenCalled();
      expect(
        await ports.service.complete(ownerId, assetId, 'complete-1', []),
      ).toMatchObject({ success: true, data: { state: 'uploaded' } });
      expect(ports.createJob).toHaveBeenCalledTimes(1);
    });

    it('should re-sign exactly the stored multipart layout and report the parts storage holds', async () => {
      const fresh = [
        { ...multipartSession.parts[0]!, putUrl: 'https://upload.example/1' },
      ];
      const ports = fixture({
        session: multipartSession,
        resume: {
          state: 'active',
          expiresAt: later,
          parts: fresh,
          uploadedParts: [{ partNumber: 1, etag: '"part-1"' }],
        },
      });

      expect(await ports.service.resume(ownerId, assetId)).toEqual({
        success: true,
        data: {
          assetId,
          mode: 'multipart',
          uploadId: 'upload-1',
          parts: fresh,
          uploadedParts: [{ partNumber: 1, etag: '"part-1"' }],
          expiresAt: later,
        },
      });
      expect(ports.resumeMultipart).toHaveBeenCalledWith(
        expect.objectContaining({ key: `originals/${assetId}` }),
        'upload-1',
        [{ partNumber: 1, offset: 0, byteLength: 64 * 1024 * 1024 }],
      );
      expect(ports.signUpload).not.toHaveBeenCalled();
      expect(ports.verifyOriginal).not.toHaveBeenCalled();
    });

    it.for(['uploaded', 'processing', 'ready', 'failed'] as const)(
      'should refuse to re-sign an upload whose asset is already %s',
      async (state) => {
        const ports = fixture({ asset: asset(state) });

        expect(await ports.service.resume(ownerId, assetId)).toEqual({
          success: false,
          error: {
            code: 'UPLOAD_ALREADY_COMPLETED',
            message: 'Media upload has already been completed',
            retryable: false,
          },
        });
        expect(ports.signUpload).not.toHaveBeenCalled();
      },
    );

    it("should hide another owner's or an unknown asset and a missing session as not found", async () => {
      for (const ports of [
        fixture({ asset: null }),
        fixture({ session: null }),
      ]) {
        expect(await ports.service.resume(ownerId, assetId)).toMatchObject({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Media not found' },
        });
        expect(ports.signUpload).not.toHaveBeenCalled();
      }
    });

    it('should report a provider-expired multipart upload as expired only when no original landed', async () => {
      const expired = fixture({
        session: multipartSession,
        resume: { state: 'expired' },
        verifyError: missing,
      });
      expect(await expired.service.resume(ownerId, assetId)).toEqual({
        success: false,
        error: {
          code: 'UPLOAD_EXPIRED',
          message: 'Upload expired; start a new upload',
          retryable: false,
        },
      });
      const assembled = fixture({
        session: multipartSession,
        resume: { state: 'expired' },
        completeMultipart: true,
        completeMultipartError: new Error('NoSuchUpload'),
      });
      expect(await assembled.service.resume(ownerId, assetId)).toMatchObject({
        success: false,
        error: { code: 'UPLOAD_STORED', retryable: false },
      });
      expect(
        await assembled.service.complete(ownerId, assetId, 'complete-1', [
          { partNumber: 1, etag: '"part-1"' },
        ]),
      ).toMatchObject({ success: true, data: { state: 'uploaded' } });
      expect(assembled.createJob).toHaveBeenCalledTimes(1);
    });

    it.for([singleSession, multipartSession])(
      'should preserve mismatch behavior when resuming a $mode upload',
      async (session) => {
        const ports = fixture({
          session,
          resume: { state: 'expired' },
          verifyError: new OriginalVerificationError({
            reason: 'mismatch',
            message: 'Stored bytes differ from the declaration',
          }),
        });

        expect(await ports.service.resume(ownerId, assetId)).toMatchObject(
          session.mode === 'single'
            ? { success: true, data: { assetId, mode: 'single' } }
            : {
                success: false,
                error: { code: 'UPLOAD_EXPIRED', retryable: false },
              },
        );
        expect(ports.createUpload).not.toHaveBeenCalled();
        expect(ports.current.asset).toEqual(asset());
      },
    );

    it('should defensively refuse multipart resumption on an adapter that cannot resume', async () => {
      const unsupported = fixture({ session: multipartSession });

      expect(await unsupported.service.resume(ownerId, assetId)).toMatchObject({
        success: false,
        error: { code: 'MEDIA_UNSUPPORTED' },
      });
      expect(unsupported.resumeMultipart).not.toHaveBeenCalled();
    });
  });
});
