/**
 * in-memory stand-in for the expo-file-system classes the upload journal uses, for jest.mock
 */

import { check, fakeDisk, join } from './fake-disk.spec.fixtures';
import { File } from './fake-file.spec.fixtures';

export { fakeDisk, resetFakeDisk } from './fake-disk.spec.fixtures';
export { File } from './fake-file.spec.fixtures';

/** fake directory */
export class Directory {
  public readonly uri: string;

  /**
   * points at a directory
   * @param parts path parts
   */
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = join(parts);
  }

  /**
   * names the directory
   * @returns its last path segment
   */
  public get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  /**
   * tells whether the directory is on the disk
   * @returns true once created
   */
  public get exists(): boolean {
    return fakeDisk().directories.has(this.uri);
  }

  /** creates the directory and its parents */
  public create(): void {
    check('write');
    const segments = this.uri.split('/');
    for (let end = 4; end <= segments.length; end += 1) {
      fakeDisk().directories.add(segments.slice(0, end).join('/'));
    }
  }

  /** deletes the directory and everything inside */
  public delete(): void {
    check('delete');
    const { files, directories } = fakeDisk();
    for (const uri of [...files.keys()]) {
      if (uri.startsWith(`${this.uri}/`)) {
        files.delete(uri);
      }
    }
    for (const uri of [...directories]) {
      if (uri === this.uri || uri.startsWith(`${this.uri}/`)) {
        directories.delete(uri);
      }
    }
  }

  /**
   * lists what the directory holds directly
   * @returns its subdirectories, then its files
   */
  public list(): Array<Directory | File> {
    check('list');
    const { files, directories } = fakeDisk();
    const isChild = (uri: string): boolean =>
      uri.startsWith(`${this.uri}/`) &&
      !uri.slice(this.uri.length + 1).includes('/');

    return [
      ...[...directories].filter(isChild).map((uri) => new Directory(uri)),
      ...[...files.keys()].filter(isChild).map((uri) => new File(uri)),
    ];
  }
}

/** fake well-known directories */
const paths = {
  /**
   * points at the documents directory, which the OS never purges
   * @returns the app's documents directory
   */
  get document(): Directory {
    return new Directory('file:///documents');
  },
};

export { paths as Paths };
