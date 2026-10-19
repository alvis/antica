import { ApiError } from '@antica/client';

import { uploadMedia } from '../../adapters/media-upload';
import { journalStore, keptCopies } from '../../adapters/upload-journal';

import type { ApiTransport } from '@antica/client';

import type { RecordDetail } from '@antica/contracts';

import type { LocalMedia } from '../../adapters/media-upload';

import type { CaptureRuntime } from './hooks/useCaptureDraft';

/** transport, language and the draft updater an upload reports through */
export interface DraftUploadContext {
  api: ApiTransport;
  t: CaptureRuntime['t'];
  /** signed-in collector whose documents keep the journals */
  userId: string | null;
  /**
   * applies a change to one draft file by its identifier, leaving the fields it does not name,
   * such as a copy recorded meanwhile, as they are in the current draft
   */
  publish: (fileId: string, patch: Partial<LocalMedia>) => void;
}

/** one file of the draft being uploaded to its record */
export interface DraftUpload {
  /** draft files being saved, updated in place */
  files: LocalMedia[];
  /** position of the file to upload */
  index: number;
  /** saved record receiving the file */
  record: RecordDetail;
  /** the record's components, which the file's label may name */
  components: RecordDetail['components'];
  /** reasons by file, filled when the upload fails */
  failures: Record<string, string>;
}

/**
 * names why a file did not upload, in the collector's language
 * @param cause error the upload rejected with
 * @param t translation function for message keys
 * @returns the stable code kept in the journal and the reason shown
 */
function describeUploadFailure(
  cause: unknown,
  t: CaptureRuntime['t'],
): { code: string; reason: string } {
  if (cause instanceof ApiError) {
    return {
      code: cause.code,
      reason:
        cause.code === 'UPLOAD_FAILED'
          ? t('uploadReasonRejected')
          : cause.message,
    };
  }

  // fetch rejects with a TypeError when the network is unreachable
  return cause instanceof TypeError
    ? { code: 'NETWORK', reason: t('uploadReasonOffline') }
    : { code: 'UNKNOWN', reason: (cause as Error).message };
}

/**
 * applies a change to one draft file by its identifier
 * @param files draft files
 * @param fileId file that changed
 * @param patch fields that changed
 * @returns the files with the change applied
 */
export function patchFile(
  files: LocalMedia[],
  fileId: string,
  patch: Partial<LocalMedia>,
): LocalMedia[] {
  return files.map((item) =>
    item.id === fileId ? { ...item, ...patch } : item,
  );
}

/**
 * waits for the copies of the draft's files still being made, so every file uploads with its
 * journal rather than racing it
 * @param files draft files about to upload
 * @returns the files with the copies kept for them
 */
export async function withKeptCopies(
  files: LocalMedia[],
): Promise<LocalMedia[]> {
  const copies = await keptCopies(files.map((file) => file.id));

  return files.map((file) =>
    copies.has(file.id) ? { ...file, copyUri: copies.get(file.id) } : file,
  );
}

/**
 * uploads one draft file through its journal when it has one, reporting part progress, and
 * marks it uploaded or failed with the reason
 * @param context transport, translations and the draft updater
 * @param upload the draft files, the position to upload and its record
 */
export async function uploadDraftFile(
  context: DraftUploadContext,
  upload: DraftUpload,
): Promise<void> {
  const { api, t, userId, publish } = context;
  const { files, index, record, components, failures } = upload;
  const file = files[index];
  const component = components.find(
    (item) => item.label === file.componentLabel.trim(),
  );
  const change = (patch: Partial<LocalMedia>): void => {
    files[index] = { ...files[index], ...patch };
    publish(file.id, patch);
  };
  change({ state: 'uploading', errorCode: undefined });
  try {
    const assetId = await uploadMedia(
      api,
      // the documents copy outlives the cache file the camera or picker returned
      file.copyUri ? { ...file, uri: file.copyUri } : file,
      { kind: 'record', id: record.id },
      component ? [component.id] : [],
      {
        store:
          file.copyUri && userId
            ? journalStore({ userId, recordId: record.id }, file.id)
            : undefined,
        onProgress: (uploaded, total) =>
          change({ progress: { uploaded, total } }),
      },
    );
    change({
      state: 'uploaded',
      assetId,
      progress: undefined,
      errorCode: undefined,
    });
  } catch (cause) {
    const failure = describeUploadFailure(cause, t);
    change({ state: 'failed', progress: undefined, errorCode: failure.code });
    failures[file.id] = failure.reason;
  }
}
