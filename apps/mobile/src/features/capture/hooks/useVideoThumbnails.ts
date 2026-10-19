import { getThumbnailAsync } from 'expo-video-thumbnails';
import { useEffect, useRef, useState } from 'react';

import { deleteLocalFile } from '../local-files';

import type { LocalMedia } from '../../../adapters/media-upload';

/**
 * makes a still image for every local video, once per file; a video whose still cannot be made
 * maps to null so its tile shows the video icon instead of an error. A still is deleted when its
 * video leaves the draft, when it arrives after the draft is gone, and when the draft is discarded
 * @param files draft files, of which only videos get stills
 * @returns still image URIs by file ID, null where none could be made
 */
export function useVideoThumbnails(
  files: readonly LocalMedia[],
): Readonly<Record<string, string | null>> {
  const [thumbnails, setThumbnails] = useState<Record<string, string | null>>(
    {},
  );
  const requested = useRef(new Set<string>());
  // stills written so far, by video, so they can be deleted with their video or the draft
  const made = useRef(new Map<string, string>());
  // false once the draft is gone; a still that arrives later is deleted instead of shown
  const alive = useRef(true);
  const videos = files.filter((file) => file.kind === 'video');
  const videoIds = videos.map((file) => file.id).join();

  useEffect(() => {
    alive.current = true;
    const stills = made.current;

    return () => {
      alive.current = false;
      for (const uri of stills.values()) {
        deleteLocalFile(uri);
      }
      stills.clear();
    };
  }, []);

  useEffect(() => {
    for (const [id, uri] of made.current) {
      if (!videos.some((video) => video.id === id)) {
        made.current.delete(id);
        deleteLocalFile(uri);
      }
    }
    for (const video of videos) {
      // checked per video, so a repeated run (as under StrictMode) never asks twice
      if (requested.current.has(video.id)) {
        continue;
      }
      requested.current.add(video.id);
      void getThumbnailAsync(video.uri, { time: 0 })
        .then(
          ({ uri }) => uri,
          () => null,
        )
        .then((uri) => {
          if (!alive.current) {
            if (uri) {
              deleteLocalFile(uri);
            }

            return;
          }
          if (uri) {
            made.current.set(video.id, uri);
          }
          setThumbnails((current) => ({ ...current, [video.id]: uri }));
        });
    }
    // `videoIds` names exactly the videos in the draft
  }, [videoIds]);

  return thumbnails;
}
