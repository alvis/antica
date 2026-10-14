/** browser-safe stand-in for the Expo file wrapper used by mobile stories */
export class File extends Blob {
  public readonly name: string;

  /**
   * creates an empty browser file reference for a native URI
   * @param uri native-style fixture URI
   */
  constructor(uri: string) {
    super([]);
    this.name = uri.split('/').pop() ?? '';
  }

  /**
   * leaves native file selection canceled in the browser fixture
   * @returns a canceled file selection
   */
  public static async pickFileAsync(): Promise<{ canceled: true }> {
    return { canceled: true };
  }

  /**
   * returns fixture bytes without reading a native file
   * @returns empty fixture bytes
   */
  public async bytes(): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array();
  }
}
