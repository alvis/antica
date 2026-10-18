import { File } from 'expo-file-system';

/**
 * deletes a file the app wrote into its own storage, such as a camera shot or a video still
 * @param uri local file to delete
 */
export function deleteLocalFile(uri: string): void {
  try {
    new File(uri).delete();
  } catch {
    // a file already removed, or never written, needs no cleanup
  }
}
