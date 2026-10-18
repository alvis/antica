/**
 * fails like a device that cannot read the video, so tiles show the video icon
 * @returns never; the promise always rejects
 */
export async function getThumbnailAsync(): Promise<never> {
  throw new Error('Video stills are unavailable in the browser.');
}
