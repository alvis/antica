import { useEffect, useRef } from 'react';

import { deleteLocalFile } from '../local-files';

import type { LocalMedia } from '../../../adapters/media-upload';

/**
 * deletes the in-app camera's photos that never left the device when the draft is discarded;
 * uploaded photos and those still uploading or awaiting a retry are kept for the upload journal
 * @param files current draft files
 */
export function useShotCleanup(files: readonly LocalMedia[]): void {
  const latest = useRef(files);

  useEffect(() => {
    latest.current = files;
  }, [files]);

  useEffect(
    () => () => {
      for (const file of latest.current) {
        // only the in-app camera tags a shot type, so imported originals are never touched
        if (file.shotType && file.state === 'local') {
          deleteLocalFile(file.uri);
        }
      }
    },
    [],
  );
}
