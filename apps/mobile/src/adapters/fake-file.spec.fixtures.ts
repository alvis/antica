import { check, fakeDisk, join } from './fake-disk.spec.fixtures';

/** fake file */
export class File {
  public uri: string;

  /**
   * points at a file
   * @param parts path parts
   */
  constructor(...parts: Array<string | { uri: string }>) {
    this.uri = join(parts);
  }

  /**
   * tells whether the file is on the disk
   * @returns true once written, copied or moved there
   */
  public get exists(): boolean {
    return fakeDisk().files.has(this.uri);
  }

  /**
   * measures the file
   * @returns its length in bytes
   */
  public get size(): number {
    return this.content().length;
  }

  /** creates an empty file */
  public create(): void {
    check('write');
    fakeDisk().files.set(this.uri, '');
  }

  /**
   * replaces the file's content
   * @param content new content
   */
  public write(content: string): void {
    check('write');
    fakeDisk().files.set(this.uri, content);
  }

  /**
   * reads the file as text, as the journal does
   * @returns the content written last
   */
  public textSync(): string {
    return String(fakeDisk().files.get(this.uri));
  }

  /**
   * reads the file whole, as an upload does before hashing it
   * @returns the content encoded as UTF-8 when it was written as text
   */
  public async bytes(): Promise<Uint8Array> {
    return this.content();
  }

  /**
   * reads a byte range
   * @param start first byte
   * @param end byte after the last
   * @returns the range as a blob
   */
  public slice(start: number, end: number): Blob {
    return new Blob([this.content().slice(start, end)]);
  }

  /**
   * copies the file
   * @param destination target file
   */
  public async copy(destination: File): Promise<void> {
    check('copy');
    const content = fakeDisk().files.get(this.uri);
    if (content === undefined) {
      throw new Error(`No such file ${this.uri}`);
    }
    fakeDisk().files.set(destination.uri, content);
  }

  /**
   * moves the file over the destination as expo-file-system does on Android: the destination
   * is deleted first, then the file is renamed, so a crash between the two leaves neither
   * @param destination target file
   */
  public moveSync(destination: File): void {
    check('move');
    const { files } = fakeDisk();
    files.delete(destination.uri);
    check('rename');
    files.set(destination.uri, files.get(this.uri) ?? '');
    files.delete(this.uri);
    this.uri = destination.uri;
  }

  /** deletes the file */
  public delete(): void {
    check('delete');
    fakeDisk().files.delete(this.uri);
  }

  /**
   * reads the stored content in binary form
   * @returns the stored bytes, encoding text as UTF-8
   */
  private content(): Uint8Array {
    const content = fakeDisk().files.get(this.uri) ?? '';

    return typeof content === 'string'
      ? new TextEncoder().encode(content)
      : content;
  }
}
