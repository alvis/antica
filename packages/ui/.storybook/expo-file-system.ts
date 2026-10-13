/** Browser-safe stand-in for the Expo file wrapper used by mobile stories. */
export class File extends Blob {
  public readonly name: string;

  /**
   * Creates an empty browser file reference for a native URI.
   * @param uri Native-style fixture URI.
   */
  constructor(uri: string) {
    super([]);
    this.name = uri.split('/').pop() ?? '';
  }

  /**
   * Leaves native file selection cancelled in the browser fixture.
   * @returns A cancelled file selection.
   */
  public static async pickFileAsync(): Promise<{ canceled: true }> {
    return { canceled: true };
  }

  /**
   * Returns fixture bytes without reading a native file.
   * @returns Empty fixture bytes.
   */
  public async bytes(): Promise<Uint8Array> {
    return new Uint8Array();
  }
}
