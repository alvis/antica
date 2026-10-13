import { ApiError } from '@antica/client';

import {
  completeUploadRequestSchema,
  mediaCompletionSchema,
  uploadRequestSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';

import type { ApiTransport } from '@antica/client';
import type { MediaKind, MediaPurpose, UploadSession } from '@antica/contracts';

interface UploadProgress {
  session: UploadSession;
  parts: Map<number, string>;
  singleUploaded: boolean;
  completionRequestKey: string;
}

const pendingUploads = new Map<string, UploadProgress>();
const uploadRequestKeys = new Map<string, string>();

export interface LocalMedia {
  id: string;
  uri: string;
  name: string;
  mimeType: string;
  kind: MediaKind;
  purpose: MediaPurpose;
  componentLabel: string;
  state: 'local' | 'uploading' | 'uploaded' | 'failed';
  assetId: string | null;
  checkLinked?: boolean;
  checkRequestKey?: string;
}

export interface UploadTarget {
  kind: 'record' | 'source_intake';
  id: string;
}

/**
 * Persists one local file with its own idempotency key and verified digest.
 * @param api
 * @param media
 * @param target
 * @param componentIds
 */
export async function uploadMedia(
  api: ApiTransport,
  media: LocalMedia,
  target: UploadTarget,
  componentIds: string[],
): Promise<string> {
  const file = new File(media.uri);
  const bytes = await file.bytes();
  const digestBytes = new Uint8Array(
    await digest(CryptoDigestAlgorithm.SHA256, bytes),
  );
  const sha256 = Array.from(digestBytes, (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  let progress = pendingUploads.get(media.id);
  const uploaded =
    progress?.session.mode === 'single'
      ? progress.singleUploaded
      : progress?.parts.size === progress?.session.parts.length;
  if (
    progress &&
    !uploaded &&
    Date.parse(progress.session.expiresAt) <= Date.now()
  ) {
    pendingUploads.delete(media.id);
    uploadRequestKeys.set(media.id, randomUUID());
    progress = undefined;
  }
  const requestKey = uploadRequestKeys.get(media.id) ?? media.id;
  const request = uploadRequestSchema.parse({
    requestKey,
    target:
      target.kind === 'record'
        ? { kind: 'record', recordId: target.id }
        : { kind: 'source_intake', intakeKey: target.id },
    kind: media.kind,
    purpose: media.purpose,
    componentIds,
    fileName: media.name,
    mimeType: media.mimeType,
    byteLength: file.size,
    sha256,
  });
  if (!progress) {
    const session = await api.post('/v1/media/uploads', uploadSessionSchema, {
      body: request,
      idempotencyKey: requestKey,
    });
    progress = {
      session,
      parts: new Map(),
      singleUploaded: false,
      completionRequestKey: randomUUID(),
    };
    pendingUploads.set(media.id, progress);
  }
  const { session } = progress;
  if (session.mode === 'single' && !progress.singleUploaded) {
    await api.putSigned(session.putUrl, file, session.headers);
    progress.singleUploaded = true;
  }
  if (session.mode === 'multipart') {
    for (const part of session.parts) {
      if (!progress.parts.has(part.partNumber)) {
        const etag = await api.putSigned(
          part.putUrl,
          file.slice(part.offset, part.offset + part.byteLength),
          part.headers,
        );
        progress.parts.set(part.partNumber, etag);
      }
    }
  }
  const parts =
    session.mode === 'multipart'
      ? [...session.parts]
          .sort((left, right) => left.partNumber - right.partNumber)
          .map((part) => ({
            partNumber: part.partNumber,
            etag: progress.parts.get(part.partNumber)!,
          }))
      : [];
  const completion = completeUploadRequestSchema.parse({
    requestKey: progress.completionRequestKey,
    parts,
  });
  const result = await api.post(
    `/v1/media/${session.assetId}/complete`,
    mediaCompletionSchema,
    { body: completion, idempotencyKey: completion.requestKey },
  );
  if (result.state === 'failed') {
    pendingUploads.delete(media.id);
    uploadRequestKeys.set(media.id, randomUUID());
    throw new ApiError(
      409,
      'UPLOAD_FAILED',
      'The uploaded file could not be verified.',
    );
  }

  pendingUploads.delete(media.id);
  uploadRequestKeys.delete(media.id);

  return result.assetId;
}
