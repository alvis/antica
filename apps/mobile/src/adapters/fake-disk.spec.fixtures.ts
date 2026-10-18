/**
 * the fake expo-file-system's disk; it lives on the global object, so a module registry rebuilt
 * to simulate an app restart still sees it
 */

/** disk operations a test can make fail; `rename` fails a move after it deleted its destination */
export type FakeOperation =
  'write' | 'move' | 'rename' | 'copy' | 'list' | 'delete';

/** what the fake disk holds: file contents by URI, and the directories that exist */
export interface FakeDisk {
  files: Map<string, string | Uint8Array>;
  directories: Set<string>;
  /** operations that throw next, to simulate a full or unreadable disk */
  failing: Set<FakeOperation>;
}

/** where the disk hangs on the global object, shared by every module registry */
const diskKey = Symbol.for('antica.fakeDisk');

const globalDisk = globalThis as typeof globalThis &
  Partial<Record<typeof diskKey, FakeDisk>>;

/**
 * returns the shared fake disk, creating it on first use
 * @returns the disk shared by every module registry
 */
export function fakeDisk(): FakeDisk {
  globalDisk[diskKey] ??= {
    files: new Map(),
    directories: new Set(['file:///documents']),
    failing: new Set(),
  };

  return globalDisk[diskKey];
}

/** empties the fake disk, leaving the documents directory */
export function resetFakeDisk(): void {
  const disk = fakeDisk();
  disk.files.clear();
  disk.directories.clear();
  disk.directories.add('file:///documents');
  disk.failing.clear();
}

/**
 * throws when the test made an operation fail
 * @param operation operation about to run
 */
export function check(operation: FakeOperation): void {
  if (fakeDisk().failing.has(operation)) {
    throw new Error(`Fake ${operation} failed`);
  }
}

/**
 * joins path parts the way expo-file-system does
 * @param parts URIs, names, files or directories
 * @returns the joined URI
 */
export function join(parts: Array<string | { uri: string }>): string {
  return parts
    .map((part) => (typeof part === 'string' ? part : part.uri))
    .join('/');
}
