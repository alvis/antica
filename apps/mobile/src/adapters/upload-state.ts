import { CryptoDigestAlgorithm, digest, randomUUID } from 'expo-crypto';

import type { UploadResume, UploadSession } from '@antica/contracts';

/** byte ranges of a started upload, kept without its signed URLs */
export type UploadLayout =
  | { mode: 'single' }
  | {
      mode: 'multipart';
      parts: Array<{ partNumber: number; offset: number; byteLength: number }>;
    };

/** what an upload has achieved so far; everything needed to continue it after a restart */
export interface UploadState {
  /** idempotency key of the start request; a new key starts a new asset */
  requestKey: string;
  assetId: string | null;
  layout: UploadLayout | null;
  /** stored part ETags by part number, exactly as storage returned them, quotes included */
  etags: Record<string, string>;
  singleUploaded: boolean;
  /** idempotency key of the completion, reused until the asset completes so it completes once */
  completionRequestKey: string;
  /** components sent with the first start, so a replayed start repeats it exactly */
  componentIds: string[] | null;
}

/** where an upload keeps its state between attempts */
export interface UploadStore {
  load: () => UploadState | null;
  save: (state: UploadState) => void;
  /** forgets the upload once its asset completed */
  clear: () => void;
}

/** upload state of files without a journal, such as voice notes and source intakes */
const memoryStates = new Map<string, UploadState>();

/**
 * keeps one file's upload state in memory, as uploads did before journals existed
 * @param fileId local file identifier
 * @returns a store that forgets the upload when the app closes
 */
export function memoryStore(fileId: string): UploadStore {
  return {
    load: () => memoryStates.get(fileId) ?? null,
    save: (state) => {
      memoryStates.set(fileId, state);
    },
    clear: () => {
      memoryStates.delete(fileId);
    },
  };
}

/**
 * describes an upload that has not started yet
 * @param requestKey idempotency key of the start request
 * @param componentIds components already pinned to the file, if any
 * @returns state with no asset and no stored bytes
 */
export function newUploadState(
  requestKey: string,
  componentIds: string[] | null,
): UploadState {
  return {
    requestKey,
    assetId: null,
    layout: null,
    etags: {},
    singleUploaded: false,
    completionRequestKey: randomUUID(),
    componentIds,
  };
}

/**
 * tells whether signed URLs can no longer be used
 * @param session signed upload session
 * @returns true once the session expired
 */
export function expired(session: UploadSession): boolean {
  return Date.parse(session.expiresAt) <= Date.now();
}

/**
 * keeps the byte ranges of a session without its signed URLs
 * @param session signed upload session
 * @returns the session's layout
 */
export function layoutOf(session: UploadSession): UploadLayout {
  return session.mode === 'single'
    ? { mode: 'single' }
    : {
        mode: 'multipart',
        parts: [...session.parts]
          .sort((left, right) => left.partNumber - right.partNumber)
          .map(({ partNumber, offset, byteLength }) => ({
            partNumber,
            offset,
            byteLength,
          })),
      };
}

/**
 * tells whether every byte of the original has been stored, so only completion remains
 * @param state current upload state
 * @returns true when the transfer is finished
 */
export function bytesStored(state: UploadState): boolean {
  const { assetId, layout } = state;
  if (!assetId || !layout) {
    return false;
  }

  return layout.mode === 'single'
    ? state.singleUploaded
    : layout.parts.every((part) => state.etags[String(part.partNumber)]);
}

/** radix of the hexadecimal digest the API expects */
const hexadecimal = 16;

/**
 * hashes the original as the API verifies it
 * @param bytes contents of the original
 * @returns the lowercase hexadecimal SHA-256 digest
 */
export async function sha256Hex(
  bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const digestBytes = new Uint8Array(
    await digest(CryptoDigestAlgorithm.SHA256, bytes),
  );

  return Array.from(digestBytes, (byte) =>
    byte.toString(hexadecimal).padStart(2, '0'),
  ).join('');
}

/**
 * separates fresh signed URLs from the parts storage already holds
 * @param resumed resumption response
 * @returns the signed session alone
 */
export function sessionOf(resumed: UploadResume): UploadSession {
  if (resumed.mode === 'single') {
    const { mode, assetId, expiresAt, putUrl, headers } = resumed;

    return { mode, assetId, expiresAt, putUrl, headers };
  }
  const { mode, assetId, expiresAt, uploadId, parts } = resumed;

  return { mode, assetId, expiresAt, uploadId, parts };
}
