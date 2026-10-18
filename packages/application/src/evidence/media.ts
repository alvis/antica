import { createHash } from 'node:crypto';

import { OriginalVerificationError } from '../ports/index.js';

import type {
  MediaCompletion,
  MediaDetail,
  UploadRequest,
  UploadResume,
  UploadSession,
} from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

/** signs immutable originals and verifies them before persistence confirms upload */
export interface MediaStoragePort {
  signUpload(input: {
    readonly assetId: string;
    readonly key: string;
    readonly mimeType: string;
    readonly byteLength: number;
    readonly sha256: string;
  }): Promise<{
    readonly url: string;
    readonly expiresAt: string;
    readonly headers: Readonly<Record<string, string>>;
  }>;
  startMultipart?(input: {
    readonly assetId: string;
    readonly key: string;
    readonly mimeType: string;
    readonly byteLength: number;
    readonly sha256: string;
  }): Promise<{
    readonly uploadId: string;
    readonly expiresAt: string;
    readonly parts: ReadonlyArray<{
      readonly partNumber: number;
      readonly offset: number;
      readonly byteLength: number;
      readonly putUrl: string;
      readonly headers: Readonly<Record<string, string>>;
    }>;
  }>;
  completeMultipart?(
    input: {
      readonly assetId: string;
      readonly key: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly sha256: string;
    },
    upload: {
      readonly uploadId: string;
      readonly layout: ReadonlyArray<{ readonly partNumber: number }>;
    },
    parts: ReadonlyArray<{
      readonly partNumber: number;
      readonly etag: string;
    }>,
  ): Promise<void>;
  resumeMultipart?(
    input: {
      readonly assetId: string;
      readonly key: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly sha256: string;
    },
    uploadId: string,
    layout: ReadonlyArray<{
      readonly partNumber: number;
      readonly offset: number;
      readonly byteLength: number;
    }>,
  ): Promise<
    | { readonly state: 'expired' }
    | {
        readonly state: 'active';
        readonly expiresAt: string;
        readonly parts: ReadonlyArray<{
          readonly partNumber: number;
          readonly offset: number;
          readonly byteLength: number;
          readonly putUrl: string;
          readonly headers: Readonly<Record<string, string>>;
        }>;
        readonly uploadedParts: ReadonlyArray<{
          readonly partNumber: number;
          readonly etag: string;
        }>;
      }
  >;
  abortMultipart?(
    input: {
      readonly assetId: string;
      readonly key: string;
      readonly mimeType: string;
      readonly byteLength: number;
      readonly sha256: string;
    },
    uploadId: string,
  ): Promise<void>;
  /** rejects with OriginalVerificationError for definite absence or mismatch; other failures remain unclassified */
  verifyOriginal(input: {
    readonly assetId: string;
    readonly key: string;
    readonly mimeType: string;
    readonly byteLength: number;
    readonly sha256: string;
  }): Promise<void>;
  signRead(
    key: string,
  ): Promise<{ readonly url: string; readonly expiresAt: string }>;
}

/** authenticated media use cases */
export interface MediaService {
  start(
    ownerId: string,
    input: UploadRequest,
  ): Promise<OperationResult<UploadSession>>;
  complete(
    ownerId: string,
    assetId: string,
    requestKey: string,
    parts?: ReadonlyArray<{
      readonly partNumber: number;
      readonly etag: string;
    }>,
  ): Promise<OperationResult<MediaCompletion>>;
  get(ownerId: string, assetId: string): Promise<OperationResult<MediaDetail>>;
  /** re-signs a pending upload so an interrupted transfer continues without a new asset */
  resume(
    ownerId: string,
    assetId: string,
  ): Promise<OperationResult<UploadResume>>;
}

/**
 * creates media commands without triggering collection analysis
 * @param transaction
 * @param storage
 * @param clock
 * @param ids
 */
export function createMediaService(
  transaction: TransactionPort,
  storage: MediaStoragePort,
  clock: ClockPort,
  ids: IdPort,
): MediaService {
  return {
    start: async (ownerId, input) => {
      const existing = await transaction.run(ownerId, async (unit) => {
        if (
          input.target.kind === 'record' &&
          !(await unit.records.get(input.target.recordId))
        ) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        const prior = await unit.commands.get(
          ownerId,
          'media.start',
          input.requestKey,
        );
        if (
          prior &&
          prior.fingerprint !==
            createHash('sha256').update(JSON.stringify(input)).digest('hex')
        ) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Idempotency key was used for a different request',
              retryable: false,
            },
          };
        }

        return {
          success: true,
          data: prior?.result as UploadSession | undefined,
        };
      });
      if (!existing.success) {
        return existing;
      }
      if (existing.data) {
        return { success: true, data: existing.data };
      }
      const assetId = ids.create();
      const original = {
        assetId,
        key: `originals/${assetId}`,
        mimeType: input.mimeType,
        byteLength: input.byteLength,
        sha256: input.sha256,
      };
      const multipart =
        input.byteLength >= 64 * 1024 * 1024 && storage.startMultipart
          ? await storage.startMultipart(original)
          : null;
      let session: UploadSession;
      if (multipart) {
        session = {
          assetId,
          mode: 'multipart',
          uploadId: multipart.uploadId,
          parts: multipart.parts.map((part) => ({
            ...part,
            headers: { ...part.headers },
          })),
          expiresAt: multipart.expiresAt,
        };
      } else {
        const signed = await storage.signUpload(original);
        session = {
          assetId,
          mode: 'single',
          putUrl: signed.url,
          headers: { ...signed.headers },
          expiresAt: signed.expiresAt,
        };
      }
      try {
        const saved = await transaction.run(ownerId, async (unit) => {
          const prior = await unit.media.getUploadByRequestKey(
            ownerId,
            input.requestKey,
          );
          if (prior) {
            return { success: true, data: prior };
          }
          await unit.media.createUpload(input, session);
          await unit.commands.insert({
            ownerId,
            operation: 'media.start',
            requestKey: input.requestKey,
            fingerprint: createHash('sha256')
              .update(JSON.stringify(input))
              .digest('hex'),
            status: 201,
            result: session,
          });

          return { success: true, data: session };
        });
        if (
          multipart &&
          saved.data.assetId !== assetId &&
          storage.abortMultipart
        ) {
          await storage.abortMultipart(original, multipart.uploadId);
        }

        return saved;
      } catch (cause) {
        if (multipart && storage.abortMultipart) {
          await storage.abortMultipart(original, multipart.uploadId);
        }
        throw cause;
      }
    },
    complete: async (ownerId, assetId, requestKey, parts) => {
      const assetResult = await transaction.run(ownerId, async (unit) => {
        const asset = await unit.media.get(assetId);

        return asset
          ? {
              success: true,
              data: {
                asset,
                session: await unit.media.getUploadSession(assetId),
              },
            }
          : {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Media not found',
                retryable: false,
              },
            };
      });
      if (!assetResult.success) {
        return assetResult;
      }
      const { asset, session } = assetResult.data;
      if (!session) {
        return {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Upload session not found',
            retryable: false,
          },
        };
      }
      if (session.mode === 'single' && parts?.length) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Single upload cannot include parts',
            retryable: false,
          },
        };
      }
      if (
        session.mode === 'multipart' &&
        (!parts ||
          parts.length !== session.parts.length ||
          parts.some(
            (part, index) =>
              part.partNumber !== session.parts[index]?.partNumber,
          ))
      ) {
        return {
          success: false,
          error: {
            code: 'VALIDATION_FAILED',
            message: 'Multipart completion needs the declared parts',
            retryable: false,
          },
        };
      }
      if (asset.state === 'awaiting_upload') {
        try {
          const original = {
            assetId,
            key: `originals/${assetId}`,
            mimeType: asset.mimeType,
            byteLength: asset.byteLength,
            sha256: asset.sha256,
          };
          if (session.mode === 'multipart') {
            if (!storage.completeMultipart) {
              return {
                success: false,
                error: {
                  code: 'MEDIA_UNSUPPORTED',
                  message: 'Multipart completion is unavailable',
                  retryable: false,
                },
              };
            }
            try {
              await storage.completeMultipart(
                original,
                { uploadId: session.uploadId, layout: session.parts },
                parts!,
              );
            } catch {
              await storage.verifyOriginal(original);
            }
          }
          await storage.verifyOriginal(original);
        } catch (cause) {
          return {
            success: false,
            error: {
              code: 'UPLOAD_INCOMPLETE',
              message: 'Original upload could not be verified',
              retryable: true,
            },
            cause,
          };
        }
      }

      return transaction.run(ownerId, async (unit) => {
        const fingerprint = createHash('sha256')
          .update(JSON.stringify({ assetId, parts: parts ?? [] }))
          .digest('hex');
        const prior = await unit.commands.get(
          ownerId,
          'media.complete',
          requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as MediaCompletion }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const current = await unit.media.get(assetId);
        if (!current) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Media not found',
              retryable: false,
            },
          };
        }
        if (current.state !== 'awaiting_upload') {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Media has already been completed',
              retryable: false,
            },
          };
        }
        const now = clock.now();
        const jobId = ids.create();
        const completion: MediaCompletion = {
          assetId,
          state: 'uploaded',
          processingJobId: jobId,
        };
        await unit.media.complete(assetId, completion);
        await unit.jobs.create({
          id: jobId,
          kind: 'media',
          resourceId: assetId,
          state: { kind: 'queued' },
          createdAt: now,
          updatedAt: now,
          result: null,
        });
        await unit.outbox.enqueue({
          id: ids.create(),
          name: 'antica.media.uploaded',
          event: {
            eventId: ids.create(),
            schemaVersion: '1',
            jobId,
            resourceId: assetId,
            ownerId,
            idempotencyKey: requestKey,
          },
          createdAt: now,
          sentAt: null,
        });
        await unit.commands.insert({
          ownerId,
          operation: 'media.complete',
          requestKey,
          fingerprint,
          status: 200,
          result: completion,
        });

        return { success: true, data: completion };
      });
    },
    resume: async (ownerId, assetId) =>
      resumeUpload({ transaction, storage }, ownerId, assetId),
    get: async (ownerId, assetId) => {
      const found = await transaction.run(ownerId, async (unit) => {
        const asset = await unit.media.get(assetId);

        return asset
          ? {
              success: true,
              data: {
                asset,
                anchors: await unit.evidence.queryAnchorsByAsset(assetId),
                record:
                  asset.owner.kind === 'record'
                    ? await unit.records.get(asset.owner.recordId)
                    : null,
                job: await unit.jobs.getByResource('media', assetId),
              },
            }
          : {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Media not found',
                retryable: false,
              },
            };
      });
      if (!found.success) {
        return found;
      }
      const { asset, anchors, record, job } = found.data;
      const keys =
        asset.state === 'awaiting_upload'
          ? []
          : [
              { id: assetId, key: `originals/${assetId}` },
              ...asset.views.flatMap((view) =>
                view.derivativeId === null
                  ? []
                  : [
                      {
                        id: view.derivativeId,
                        key: `derivatives/${assetId}/${view.derivativeId}`,
                      },
                    ],
              ),
            ];
      const reads = await Promise.all(
        keys.map(async (entry) => {
          const signed = await storage.signRead(entry.key);

          return {
            assetOrDerivativeId: entry.id,
            url: signed.url,
            expiresAt: signed.expiresAt,
          };
        }),
      );
      const versions = record
        ? {
            recordRevision: record.recordRevision,
            analysisInputVersion: record.analysisInputVersion,
            evidenceVersion: record.evidenceVersion,
          }
        : null;

      return {
        success: true,
        data: {
          asset,
          reads,
          anchors: [...anchors],
          processingJobId: job?.id ?? null,
          versions,
        },
      };
    },
  };
}

/**
 * re-signs an owned pending upload without changing persisted state
 * @param ports owner-scoped persistence and the original's storage signer
 * @param ports.transaction owner-scoped persistence boundary
 * @param ports.storage signer for the original's provider upload
 * @param ownerId authenticated collector
 * @param assetId asset whose upload is resumed
 * @returns fresh transfer authority, or a stable reason it cannot resume
 */
async function resumeUpload(
  ports: {
    readonly transaction: TransactionPort;
    readonly storage: MediaStoragePort;
  },
  ownerId: string,
  assetId: string,
): Promise<OperationResult<UploadResume>> {
  const found = await ports.transaction.run(ownerId, async (unit) => {
    const asset = await unit.media.get(assetId);
    const session = asset ? await unit.media.getUploadSession(assetId) : null;

    return asset && session
      ? { success: true, data: { asset, session } }
      : {
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Media not found',
            retryable: false,
          },
        };
  });
  if (!found.success) {
    return found;
  }
  const { asset, session } = found.data;
  if (asset.state !== 'awaiting_upload') {
    return {
      success: false,
      error: {
        code: 'UPLOAD_ALREADY_COMPLETED',
        message: 'Media upload has already been completed',
        retryable: false,
      },
    };
  }
  const original = {
    assetId,
    key: `originals/${assetId}`,
    mimeType: asset.mimeType,
    byteLength: asset.byteLength,
    sha256: asset.sha256,
  };

  return session.mode === 'single'
    ? resumeSingle(ports.storage, original)
    : resumeMultipart(ports.storage, original, session);
}

/**
 * reports whether the verified original already landed, so resumption must complete instead
 * @param storage verifier of stored originals
 * @param original immutable original awaiting upload completion
 * @returns whether the stored bytes match, or a retryable failure to inspect storage
 */
async function isOriginalStored(
  storage: MediaStoragePort,
  original: Parameters<MediaStoragePort['verifyOriginal']>[0],
): Promise<OperationResult<boolean>> {
  try {
    await storage.verifyOriginal(original);

    return { success: true, data: true };
  } catch (cause) {
    if (cause instanceof OriginalVerificationError) {
      return { success: true, data: false };
    }

    return {
      success: false,
      error: {
        code: 'UPLOAD_INCOMPLETE',
        message: 'Original upload could not be verified',
        retryable: true,
      },
      cause,
    };
  }
}

/** stable failure telling a resuming client to complete its already-stored original */
const uploadStored = {
  success: false,
  error: {
    code: 'UPLOAD_STORED',
    message: 'The file is already stored; complete the upload.',
    retryable: false,
  },
} as const;

/**
 * re-signs a single upload unless its bytes already landed
 * @param storage signer and verifier for the original
 * @param original immutable original awaiting upload completion
 * @returns fresh upload authority, or the already-stored signal
 */
async function resumeSingle(
  storage: MediaStoragePort,
  original: Parameters<MediaStoragePort['signUpload']>[0],
): Promise<OperationResult<UploadResume>> {
  const stored = await isOriginalStored(storage, original);
  if (!stored.success) {
    return stored;
  }
  if (stored.data) {
    return uploadStored;
  }
  const signed = await storage.signUpload(original);

  return {
    success: true,
    data: {
      assetId: original.assetId,
      mode: 'single',
      putUrl: signed.url,
      headers: { ...signed.headers },
      expiresAt: signed.expiresAt,
      uploadedParts: [],
    },
  };
}

/**
 * re-signs the stored multipart layout, or explains why the provider upload is gone;
 * the MEDIA_UNSUPPORTED branch is defensive, since only adapters that start multipart
 * uploads can hold one and the local adapter never does
 * @param storage signer and verifier for the original
 * @param original immutable original awaiting upload completion
 * @param session multipart session persisted when the upload started
 * @returns fresh part authority with provider-held parts, or why it cannot resume
 */
async function resumeMultipart(
  storage: MediaStoragePort,
  original: Parameters<MediaStoragePort['signUpload']>[0],
  session: Extract<UploadSession, { mode: 'multipart' }>,
): Promise<OperationResult<UploadResume>> {
  if (!storage.resumeMultipart) {
    return {
      success: false,
      error: {
        code: 'MEDIA_UNSUPPORTED',
        message: 'Multipart resumption is unavailable',
        retryable: false,
      },
    };
  }
  const resumed = await storage.resumeMultipart(
    original,
    session.uploadId,
    session.parts.map(({ partNumber, offset, byteLength }) => ({
      partNumber,
      offset,
      byteLength,
    })),
  );
  if (resumed.state === 'expired') {
    // the provider assembles and drops the upload when completion reached storage before persistence
    const stored = await isOriginalStored(storage, original);
    if (!stored.success) {
      return stored;
    }

    return stored.data
      ? uploadStored
      : {
          success: false,
          error: {
            code: 'UPLOAD_EXPIRED',
            message: 'Upload expired; start a new upload',
            retryable: false,
          },
        };
  }

  return {
    success: true,
    data: {
      assetId: original.assetId,
      mode: 'multipart',
      uploadId: session.uploadId,
      parts: resumed.parts.map((part) => ({
        partNumber: part.partNumber,
        offset: part.offset,
        byteLength: part.byteLength,
        putUrl: part.putUrl,
        headers: { ...part.headers },
      })),
      uploadedParts: resumed.uploadedParts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
      })),
      expiresAt: resumed.expiresAt,
    },
  };
}
