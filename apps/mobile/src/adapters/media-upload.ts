import { randomUUID } from 'expo-crypto';

import { File } from 'expo-file-system';

import { ApiError } from '@antica/client';

import {
  completeUploadRequestSchema,
  mediaCompletionSchema,
  mediaDetailSchema,
  uploadRequestSchema,
  uploadResumeSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import {
  bytesStored,
  expired,
  layoutOf,
  memoryStore,
  newUploadState,
  sessionOf,
  sha256Hex,
} from './upload-state';

import type { ApiTransport } from '@antica/client';
import type { MediaKind, MediaPurpose, UploadSession } from '@antica/contracts';

import type { UploadState, UploadStore } from './upload-state';

export type { UploadLayout, UploadState, UploadStore } from './upload-state';
export { newUploadState } from './upload-state';

/** local media selection and upload state */
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
  /** evidence anchor created for this photo when it answers a check or an analysis action */
  anchorId?: string;
  /**
   * shot the collector chose in the in-app camera; a local hint for label suggestions,
   * never uploaded because the media contract has no field for it
   */
  shotType?: 'set' | 'base' | 'mark' | 'detail';
  /** left out of saving by the collector; the local file stays until the draft is discarded */
  excluded?: boolean;
  /**
   * copy of the original kept in the app's documents with its upload journal; null when the
   * copy could not be made, so the file uploads without surviving a restart
   */
  copyUri?: string | null;
  /** parts stored so far while the file uploads */
  progress?: { uploaded: number; total: number };
  /** stable reason the last upload attempt failed */
  errorCode?: string;
}

/** record or source intake receiving an uploaded file */
export interface UploadTarget {
  kind: 'record' | 'source_intake';
  id: string;
}

/** optional persistence and progress reporting for one upload */
export interface UploadOptions {
  /** persisted state; without one the state lives in memory until the app closes */
  store?: UploadStore;
  /** reports stored parts out of all parts after each step */
  onProgress?: (uploaded: number, total: number) => void;
}

/** one upload attempt with its file, store and current state */
interface UploadRun {
  api: ApiTransport;
  media: LocalMedia;
  target: UploadTarget;
  file: File;
  store: UploadStore;
  state: UploadState;
  /** components the file was first sent with */
  componentIds: string[];
  onProgress?: (uploaded: number, total: number) => void;
}

/** what opening an upload yields: signed URLs, or the server's reason no transfer is needed */
type Opening = UploadSession | 'stored' | 'completed' | 'expired';

/** the started asset with what opening it yielded */
interface OpenedUpload {
  assetId: string;
  opening: Opening;
}

/** attempts to open a session within one call before giving up on repeatedly expiring URLs */
const maximumRounds = 3;

/** signed sessions by local file; URLs live only in memory and are re-signed after a restart */
const liveSessions = new Map<string, UploadSession>();

/**
 * records progress and writes it to the store before the next step
 * @param run current upload attempt
 * @param patch fields that changed
 */
function persist(run: UploadRun, patch: Partial<UploadState>): void {
  run.state = { ...run.state, ...patch };
  run.store.save(run.state);
}

/**
 * builds the error raised when stored bytes fail verification
 * @returns the verification failure
 */
function verificationFailed(): ApiError {
  return new ApiError({
    status: 409,
    code: 'UPLOAD_FAILED',
    message: 'The uploaded file could not be verified.',
  });
}

/**
 * starts the file again under a new request key, as a new asset
 * @param run current upload attempt
 */
function restart(run: UploadRun): void {
  liveSessions.delete(run.media.id);
  persist(run, newUploadState(randomUUID(), run.state.componentIds));
}

/**
 * forgets a completed upload
 * @param run current upload attempt
 * @param assetId completed asset
 * @returns the completed asset
 */
function finish(run: UploadRun, assetId: string): string {
  liveSessions.delete(run.media.id);
  run.store.clear();

  return assetId;
}

/**
 * declares the file and receives signed URLs; a replayed request key returns the same asset
 * @param run current upload attempt
 * @returns the signed session
 */
async function start(run: UploadRun): Promise<UploadSession> {
  const bytes = await run.file.bytes();
  const sha256 = await sha256Hex(bytes);
  const { media, target, state } = run;
  const request = uploadRequestSchema.parse({
    requestKey: state.requestKey,
    target:
      target.kind === 'record'
        ? { kind: 'record', recordId: target.id }
        : { kind: 'source_intake', intakeKey: target.id },
    kind: media.kind,
    purpose: media.purpose,
    componentIds: run.componentIds,
    fileName: media.name,
    mimeType: media.mimeType,
    byteLength: run.file.size,
    sha256,
  });
  const session = await run.api.post('/v1/media/uploads', uploadSessionSchema, {
    body: request,
    idempotencyKey: request.requestKey,
  });
  liveSessions.set(media.id, session);
  persist(run, { assetId: session.assetId, layout: layoutOf(session) });

  return session;
}

/**
 * re-signs a started upload; storage's own list of parts replaces the journal's, so a part the
 * journal remembers but storage lacks is sent again
 * @param run current upload attempt with an asset
 * @param assetId asset being resumed
 * @returns the fresh session, or why no transfer is needed or possible
 */
async function resume(run: UploadRun, assetId: string): Promise<Opening> {
  try {
    const resumed = await run.api.get(
      `/v1/media/${assetId}/upload`,
      uploadResumeSchema,
    );
    const session = sessionOf(resumed);
    liveSessions.set(run.media.id, session);
    persist(run, {
      layout: layoutOf(session),
      etags: Object.fromEntries(
        resumed.uploadedParts.map((part) => [
          String(part.partNumber),
          part.etag,
        ]),
      ),
      singleUploaded: false,
    });

    return session;
  } catch (cause) {
    const code = cause instanceof ApiError ? cause.code : '';
    if (code === 'UPLOAD_STORED') {
      return 'stored';
    }
    if (code === 'UPLOAD_ALREADY_COMPLETED') {
      return 'completed';
    }
    if (code === 'UPLOAD_EXPIRED') {
      return 'expired';
    }
    throw cause;
  }
}

/**
 * finds usable signed URLs: a new start, the URLs of this session, or a resumption
 * @param run current upload attempt
 * @returns the started asset with the session to transfer with, or why none is needed
 */
async function open(run: UploadRun): Promise<OpenedUpload> {
  const { assetId } = run.state;
  if (!assetId) {
    const session = await start(run);

    return {
      assetId: session.assetId,
      // a replayed start returns the first session, whose URLs may have expired since
      opening: expired(session) ? await resume(run, session.assetId) : session,
    };
  }
  const live = liveSessions.get(run.media.id);

  return {
    assetId,
    opening: live && !expired(live) ? live : await resume(run, assetId),
  };
}

/**
 * sends the bytes storage does not hold yet, writing progress after every part
 * @param run current upload attempt
 * @param session signed session
 * @returns false when the URLs expired before every part was sent
 */
async function transfer(
  run: UploadRun,
  session: UploadSession,
): Promise<boolean> {
  const { api, file } = run;
  if (session.mode === 'single') {
    run.onProgress?.(0, 1);
    await api.putSigned(session.putUrl, file, session.headers);
    persist(run, { singleUploaded: true });
    run.onProgress?.(1, 1);

    return true;
  }
  const parts = [...session.parts].sort(
    (left, right) => left.partNumber - right.partNumber,
  );
  const report = (): void =>
    run.onProgress?.(
      parts.filter((part) => run.state.etags[String(part.partNumber)]).length,
      parts.length,
    );
  report();
  for (const part of parts) {
    if (run.state.etags[String(part.partNumber)]) {
      continue;
    }
    if (expired(session)) {
      liveSessions.delete(run.media.id);

      return false;
    }
    const etag = await api.putSigned(
      part.putUrl,
      file.slice(part.offset, part.offset + part.byteLength),
      part.headers,
    );
    persist(run, {
      etags: { ...run.state.etags, [String(part.partNumber)]: etag },
    });
    report();
  }

  return true;
}

/**
 * completes the asset under its one completion key, so a lost reply never completes it twice
 * @param run current upload attempt with an asset
 * @param assetId asset to complete
 * @returns the completed asset
 * @throws {ApiError} when the stored bytes fail verification
 */
async function complete(run: UploadRun, assetId: string): Promise<string> {
  const { layout, etags, completionRequestKey } = run.state;
  const parts =
    layout?.mode === 'multipart'
      ? layout.parts.flatMap((part) => {
          const etag = etags[String(part.partNumber)];

          return etag ? [{ partNumber: part.partNumber, etag }] : [];
        })
      : [];
  const completion = completeUploadRequestSchema.parse({
    requestKey: completionRequestKey,
    parts,
  });
  let result;
  try {
    result = await run.api.post(
      `/v1/media/${assetId}/complete`,
      mediaCompletionSchema,
      { body: completion, idempotencyKey: completion.requestKey },
    );
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === 'UPLOAD_INCOMPLETE') {
      // nothing completed, so the next attempt asks storage what it holds under a new key
      liveSessions.delete(run.media.id);
      persist(run, {
        etags: {},
        singleUploaded: false,
        completionRequestKey: randomUUID(),
      });
    }
    throw cause;
  }
  if (result.state === 'failed') {
    restart(run);
    throw verificationFailed();
  }

  return finish(run, result.assetId);
}

/**
 * reads the final state of an asset the server already completed
 * @param run current upload attempt with an asset
 * @param assetId completed asset
 * @returns the asset when it verified
 * @throws {ApiError} when the asset failed verification
 */
async function settle(run: UploadRun, assetId: string): Promise<string> {
  const detail = await run.api.get(`/v1/media/${assetId}`, mediaDetailSchema);
  if (detail.asset.state === 'failed') {
    restart(run);
    throw verificationFailed();
  }

  return finish(run, assetId);
}

/**
 * persists one local file with its own idempotency key and verified digest; a retry, or a
 * restart with a persisted store, sends only what storage lacks and completes under the same
 * completion key, so the file becomes one asset however often it is retried
 * @param api mobile API transport
 * @param media local file and upload state
 * @param target record or intake receiving the asset
 * @param componentIds components associated with the uploaded file
 * @param options persisted store and progress reporting
 * @returns uploaded asset identifier
 * @throws {ApiError} when upload completion reports failed verification
 */
export async function uploadMedia(
  api: ApiTransport,
  media: LocalMedia,
  target: UploadTarget,
  componentIds: string[],
  options: UploadOptions = {},
): Promise<string> {
  const store = options.store ?? memoryStore(media.id);
  const state = store.load() ?? newUploadState(media.id, null);
  const run: UploadRun = {
    api,
    media,
    target,
    file: new File(media.uri),
    store,
    state,
    // a replayed start must repeat the first request exactly, so components stay as first sent
    componentIds: state.componentIds ?? componentIds,
    onProgress: options.onProgress,
  };
  if (!state.componentIds) {
    persist(run, { componentIds: run.componentIds });
  }
  for (let round = 0; round < maximumRounds; round += 1) {
    const { assetId } = run.state;
    if (assetId && bytesStored(run.state)) {
      return complete(run, assetId);
    }
    const { assetId: startedAsset, opening } = await open(run);
    if (opening === 'stored') {
      return complete(run, startedAsset);
    }
    if (opening === 'completed') {
      return settle(run, startedAsset);
    }
    if (opening === 'expired') {
      restart(run);
      continue;
    }
    if (await transfer(run, opening)) {
      return complete(run, startedAsset);
    }
  }
  throw new ApiError({
    status: 410,
    code: 'UPLOAD_EXPIRED',
    message: 'The upload kept expiring before it finished.',
  });
}
