import { File } from 'expo-file-system';

import { newUploadState } from './media-upload';
import {
  deleteDirectory,
  fileDirectory,
  readEntry,
  readJournals,
  recordDirectory,
  safeSegments,
  writeEntry,
} from './upload-journal-disk';

import type { LocalMedia, UploadStore } from './media-upload';
import type {
  JournalListing,
  JournalScope,
  UploadJournalEntry,
} from './upload-journal-disk';

export type {
  JournalListing,
  JournalScope,
  UnreadableJournal,
  UploadJournalEntry,
} from './upload-journal-disk';

/** draft fields the journal mirrors as the collector edits the draft */
export type JournalDraftFields = Pick<
  UploadJournalEntry,
  'recordLabel' | 'componentLabel' | 'excluded' | 'state' | 'lastErrorCode'
>;

/** unfinished files of one of the collector's records, offered for resumption after a restart */
export interface UnfinishedUploads extends JournalScope {
  recordLabel: string;
  count: number;
}

/** extensions kept on the copy, so the copy keeps its type */
const extensionPattern = /\.[A-Za-z0-9]{1,8}$/;

/** records whose draft is open, once per open draft, so their files count as on screen */
const claims: string[] = [];

/** copies being made, or made, in this process by file, so an upload waits for its journal */
const copies = new Map<string, Promise<string | null>>();

const listeners = new Set<() => void>();

/** tells listeners the set of unfinished uploads may have changed */
function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * changes an existing journal; a journal already removed stays removed
 * @param scope collector and record receiving the file
 * @param fileId local file identifier
 * @param patch fields that changed
 */
function updateEntry(
  scope: JournalScope,
  fileId: string,
  patch: Partial<UploadJournalEntry>,
): void {
  const entry = readEntry(fileDirectory(scope, fileId));
  if (entry) {
    writeEntry(scope.userId, { ...entry, ...patch });
  }
}

/**
 * copies a draft file into the documents directory and writes its first journal
 * @param media draft file just added
 * @param record collector and record receiving the file, with the record's label
 * @returns the file with its copy, or null when no copy could be kept
 */
async function copyOriginal(
  media: LocalMedia,
  record: JournalScope & { label: string },
): Promise<LocalMedia | null> {
  if (!safeSegments(record.userId, record.recordId, media.id)) {
    return null;
  }
  try {
    const directory = fileDirectory(record, media.id);
    directory.create({ intermediates: true, idempotent: true });
    const extension = extensionPattern.exec(media.name)?.[0] ?? '';
    const copy = new File(directory, `original${extension}`);
    await new File(media.uri).copy(copy, { overwrite: true });
    writeEntry(record.userId, {
      ...newUploadState(media.id, null),
      version: 1,
      fileId: media.id,
      recordId: record.recordId,
      recordLabel: record.label,
      copyUri: copy.uri,
      name: media.name,
      mimeType: media.mimeType,
      kind: media.kind,
      purpose: media.purpose,
      componentLabel: media.componentLabel,
      checkRequestKey: media.checkRequestKey ?? null,
      excluded: media.excluded === true,
      state: 'local',
      lastErrorCode: null,
      createdAt: new Date().toISOString(),
    });

    return { ...media, copyUri: copy.uri };
  } catch {
    // without room or access in documents the file still uploads, without restart protection
    return null;
  }
}

/**
 * copies a draft file into the documents directory and writes its first journal, so the photo
 * survives the cache being purged and the app closing; uploads wait for it through keptCopies
 * @param media draft file just added
 * @param record collector and record receiving the file, with the record's label
 * @returns the file with its copy, or null when no copy could be kept
 */
export async function keepFile(
  media: LocalMedia,
  record: JournalScope & { label: string },
): Promise<LocalMedia | null> {
  const kept = copyOriginal(media, record);
  copies.set(
    media.id,
    kept.then((file) => file?.copyUri ?? null),
  );

  return kept;
}

/**
 * waits for every copy of the given files still being made, so each uploads with its journal
 * @param fileIds draft files about to upload
 * @returns where each file kept in this process was copied, or null when no copy was kept
 */
export async function keptCopies(
  fileIds: readonly string[],
): Promise<Map<string, string | null>> {
  const settled = await Promise.all(
    fileIds.flatMap((fileId) => {
      const copy = copies.get(fileId);

      return copy ? [copy.then((uri) => [fileId, uri] as const)] : [];
    }),
  );

  return new Map(settled);
}

/**
 * mirrors the collector's edits and the upload state of a draft file into its journal
 * @param scope collector and record receiving the file
 * @param fileId local file identifier
 * @param fields current draft fields
 */
export function updateJournal(
  scope: JournalScope,
  fileId: string,
  fields: JournalDraftFields,
): void {
  try {
    updateEntry(scope, fileId, fields);
  } catch {
    // the journal keeps its previous fields; the upload itself is unaffected
  }
}

/**
 * keeps one file's upload state in its journal, written after every stored part
 * @param scope collector and record receiving the file
 * @param fileId local file identifier
 * @returns the persisted store
 */
export function journalStore(scope: JournalScope, fileId: string): UploadStore {
  return {
    load: () => {
      const entry = readEntry(fileDirectory(scope, fileId));

      return entry
        ? {
            requestKey: entry.requestKey,
            assetId: entry.assetId,
            layout: entry.layout,
            etags: entry.etags,
            singleUploaded: entry.singleUploaded,
            completionRequestKey: entry.completionRequestKey,
            componentIds: entry.componentIds,
          }
        : null;
    },
    save: (state) => updateEntry(scope, fileId, state),
    clear: () => discardFile(scope, fileId),
  };
}

/**
 * lists the signed-in collector's journals; another collector's never show, and directories
 * without a usable journal are reported apart so they are deleted rather than uploaded
 * @param userId signed-in collector
 * @returns the collector's journals and unusable file directories
 */
export function listJournals(userId: string): JournalListing {
  try {
    return readJournals(userId);
  } catch {
    // an unreadable documents directory holds nothing this app can resume
    return { entries: [], unreadable: [] };
  }
}

/**
 * rebuilds the draft files of a record from their journals after a restart
 * @param scope collector and record whose files are restored
 * @returns draft files backed by their copies, oldest first
 */
export function restoreFiles(scope: JournalScope): LocalMedia[] {
  return listJournals(scope.userId)
    .entries.filter((entry) => entry.recordId === scope.recordId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .map((entry) => ({
      id: entry.fileId,
      uri: entry.copyUri,
      copyUri: entry.copyUri,
      name: entry.name,
      mimeType: entry.mimeType,
      kind: entry.kind,
      purpose: entry.purpose,
      componentLabel: entry.componentLabel,
      // a file the app closed on stays queued until the collector resumes it
      state: entry.state === 'failed' ? 'failed' : 'local',
      assetId: null,
      ...(entry.checkRequestKey
        ? { checkRequestKey: entry.checkRequestKey }
        : {}),
      ...(entry.excluded ? { excluded: true } : {}),
      ...(entry.lastErrorCode ? { errorCode: entry.lastErrorCode } : {}),
    }));
}

/**
 * groups the collector's unfinished files by record, leaving out records whose draft is open
 * @param userId signed-in collector
 * @returns records with files still to upload, the most recent first
 */
export function unfinishedUploads(userId: string): UnfinishedUploads[] {
  const groups = new Map<string, UnfinishedUploads & { latest: string }>();
  for (const entry of listJournals(userId).entries) {
    if (entry.excluded || claims.includes(entry.recordId)) {
      continue;
    }
    const group = groups.get(entry.recordId);
    groups.set(entry.recordId, {
      userId,
      recordId: entry.recordId,
      recordLabel: entry.recordLabel,
      count: (group?.count ?? 0) + 1,
      latest:
        group && group.latest > entry.createdAt
          ? group.latest
          : entry.createdAt,
    });
  }

  return [...groups.values()]
    .sort((left, right) => right.latest.localeCompare(left.latest))
    .map(({ recordId, recordLabel, count }) => ({
      userId,
      recordId,
      recordLabel,
      count,
    }));
}

/**
 * deletes one file's journal and its copy
 * @param scope collector and record receiving the file
 * @param fileId local file identifier
 */
export function discardFile(scope: JournalScope, fileId: string): void {
  copies.delete(fileId);
  try {
    deleteDirectory(fileDirectory(scope, fileId));
    const record = recordDirectory(scope);
    if (record.exists && record.list().length === 0) {
      record.delete();
    }
  } catch {
    // a copy that cannot be deleted is retried when the record is discarded
  }
  notify();
}

/**
 * deletes every journal and copy of a record, usable or not; assets already started on the
 * server stay pending there, since the API offers no way to abort them
 * @param scope collector and record whose unfinished files are discarded
 */
export function discardRecord(scope: JournalScope): void {
  try {
    deleteDirectory(recordDirectory(scope));
  } catch {
    // nothing left to delete
  }
  notify();
}

/**
 * deletes, at startup, the file directories of the collector that hold no usable journal, leaving
 * records whose draft is open since their copies may still be written
 * @param userId signed-in collector
 */
export function cleanJournals(userId: string): void {
  for (const folder of listJournals(userId).unreadable) {
    if (!claims.includes(folder.recordId)) {
      discardFile(folder, folder.fileId);
    }
  }
}

/**
 * marks a record's draft as open, so its files are not offered for resumption elsewhere
 * @param recordId record whose draft opened
 * @returns releases the claim when the draft closes
 */
export function claimRecord(recordId: string): () => void {
  claims.push(recordId);
  notify();
  let released = false;

  return () => {
    if (!released) {
      released = true;
      claims.splice(claims.indexOf(recordId), 1);
      notify();
    }
  };
}

/**
 * listens for changes to the unfinished uploads
 * @param listener called after a claim, release or discard
 * @returns stops listening
 */
export function subscribeJournals(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}
