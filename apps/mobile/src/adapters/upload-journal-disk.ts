import { Directory, File, Paths } from 'expo-file-system';

import type { LocalMedia, UploadState } from './media-upload';

/**
 * one draft file's upload journal, kept in the app's documents beside a copy of the original so
 * the upload survives the app closing and the OS purging its cache
 */
export interface UploadJournalEntry extends UploadState {
  version: 1;
  fileId: string;
  recordId: string;
  /** record name, or its code while it has none, for the restart prompt */
  recordLabel: string;
  /** copy of the original in the documents directory */
  copyUri: string;
  name: string;
  mimeType: string;
  kind: LocalMedia['kind'];
  purpose: LocalMedia['purpose'];
  componentLabel: string;
  checkRequestKey: string | null;
  excluded: boolean;
  state: LocalMedia['state'];
  lastErrorCode: string | null;
  createdAt: string;
}

/** whose journals: one signed-in collector's files for one record */
export interface JournalScope {
  userId: string;
  recordId: string;
}

/** one file directory whose journal this version cannot use, so it is never uploaded */
export interface UnreadableJournal extends JournalScope {
  fileId: string;
}

/** a collector's journals, apart from the file directories that hold no usable journal */
export interface JournalListing {
  entries: UploadJournalEntry[];
  unreadable: UnreadableJournal[];
}

const journalName = 'journal.json';

const temporaryName = `${journalName}.tmp`;

/** journal states a draft file can be in */
const fileStates: ReadonlySet<unknown> = new Set([
  'local',
  'uploading',
  'uploaded',
  'failed',
]);

/** fields every journal holds as text */
const textFields = [
  'fileId',
  'recordId',
  'copyUri',
  'name',
  'mimeType',
  'requestKey',
  'completionRequestKey',
];

/** fields every stored part range holds as whole numbers */
const partFields = ['partNumber', 'offset', 'byteLength'];

/** identifiers safe to use as one directory name */
const segmentPattern = /^[\w-]+$/;

/**
 * tells whether identifiers can name directories without leaving the uploads directory
 * @param segments user, record or file identifiers
 * @returns true when every identifier is one safe directory name
 */
export function safeSegments(...segments: string[]): boolean {
  return segments.every((segment) => segmentPattern.test(segment));
}

/**
 * finds the directory holding one file's journal and copy
 * @param scope collector and record receiving the file
 * @param fileId local file identifier
 * @returns the file's journal directory
 */
export function fileDirectory(scope: JournalScope, fileId: string): Directory {
  return new Directory(
    Paths.document,
    'uploads',
    scope.userId,
    scope.recordId,
    fileId,
  );
}

/**
 * finds the directory holding a record's journals
 * @param scope collector and record
 * @returns the record's journal directory
 */
export function recordDirectory(scope: JournalScope): Directory {
  return new Directory(Paths.document, 'uploads', scope.userId, scope.recordId);
}

/**
 * tells whether a value read from disk is a stored part range
 * @param value parsed part
 * @returns true for a part with its number, offset and length
 */
function isPart(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    partFields.every((key) =>
      Number.isInteger((value as Record<string, unknown>)[key]),
    )
  );
}

/**
 * tells whether a value read from disk is an upload layout, or none yet
 * @param value parsed layout
 * @returns true for no layout, a single upload, or multipart ranges
 */
function isLayout(value: unknown): boolean {
  if (value === null) {
    return true;
  }
  const layout = (typeof value === 'object' ? value : {}) as Record<
    string,
    unknown
  >;

  return (
    layout.mode === 'single' ||
    (layout.mode === 'multipart' &&
      Array.isArray(layout.parts) &&
      layout.parts.every(isPart))
  );
}

/**
 * tells whether a value read from disk is a journal this version can use
 * @param value parsed journal content
 * @returns true for a complete journal entry
 */
function isEntry(value: unknown): value is UploadJournalEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;

  return (
    entry.version === 1 &&
    textFields.every((key) => typeof entry[key] === 'string') &&
    (entry.assetId === null || typeof entry.assetId === 'string') &&
    isLayout(entry.layout) &&
    typeof entry.etags === 'object' &&
    entry.etags !== null &&
    fileStates.has(entry.state)
  );
}

/**
 * parses one journal file
 * @param file journal or its temporary successor
 * @returns the journal, or null when it cannot be used
 */
function parseEntry(file: File): UploadJournalEntry | null {
  try {
    const value: unknown = JSON.parse(file.textSync());

    return isEntry(value) ? value : null;
  } catch {
    // a journal that cannot be parsed cannot be resumed
    return null;
  }
}

/**
 * reads one file's journal; when a write was cut between deleting the journal and renaming its
 * successor over it, as Android's move does, the whole successor is promoted to the journal
 * @param directory the file's journal directory
 * @returns the journal, or null when it is missing or unreadable
 */
export function readEntry(directory: Directory): UploadJournalEntry | null {
  const journal = new File(directory, journalName);
  if (journal.exists) {
    return parseEntry(journal);
  }
  const successor = new File(directory, temporaryName);
  const entry = successor.exists ? parseEntry(successor) : null;
  if (entry) {
    try {
      successor.moveSync(journal, { overwrite: true });
    } catch {
      // the successor stays readable in place and is promoted on the next read
    }
  }

  return entry;
}

/**
 * writes a journal atomically: a temporary file is written, then renamed over the journal, so
 * a crash leaves the previous journal, or the next one in the temporary file, never a torn one
 * @param userId collector the file belongs to
 * @param entry journal to write
 */
export function writeEntry(userId: string, entry: UploadJournalEntry): void {
  const directory = fileDirectory(
    { userId, recordId: entry.recordId },
    entry.fileId,
  );
  directory.create({ intermediates: true, idempotent: true });
  const temporary = new File(directory, temporaryName);
  temporary.create({ overwrite: true });
  temporary.write(JSON.stringify(entry));
  temporary.moveSync(new File(directory, journalName), { overwrite: true });
}

/**
 * deletes a directory and everything in it, if it still exists
 * @param directory directory to delete
 */
export function deleteDirectory(directory: Directory): void {
  if (directory.exists) {
    directory.delete();
  }
}

/**
 * lists a collector's journals, and apart from them every file directory without a usable one:
 * a torn or future journal, a lone temporary file, or a copy whose journal was never written
 * @param userId signed-in collector
 * @returns the collector's usable journals and unusable file directories
 */
export function readJournals(userId: string): JournalListing {
  const listing: JournalListing = { entries: [], unreadable: [] };
  const root = new Directory(Paths.document, 'uploads', userId);
  if (!safeSegments(userId) || !root.exists) {
    return listing;
  }
  for (const record of root.list()) {
    if (!(record instanceof Directory)) {
      continue;
    }
    for (const file of record.list()) {
      if (file instanceof Directory) {
        const entry = readEntry(file);
        if (entry) {
          listing.entries.push(entry);
        } else {
          listing.unreadable.push({
            userId,
            recordId: record.name,
            fileId: file.name,
          });
        }
      }
    }
  }

  return listing;
}
