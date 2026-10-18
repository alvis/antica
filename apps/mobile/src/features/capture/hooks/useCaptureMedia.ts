import { randomUUID } from 'expo-crypto';
import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';

import type { Dispatch, SetStateAction } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

import type { CaptureDraft, CaptureRuntime } from './useCaptureDraft';

/** adds photos or videos to the draft from the camera or the library */
export type ChooseMedia = (
  camera: boolean,
  video: boolean,
  purpose?: LocalMedia['purpose'],
) => Promise<void>;

/**
 * builds the action that adds camera or library media to the capture draft
 * @param options draft updater, error reporter, and translations
 * @param options.setDraft capture draft updater
 * @param options.setError capture error reporter
 * @param options.t translation function for message keys
 * @returns the media chooser
 */
export function useCaptureMedia({
  setDraft,
  setError,
  t,
}: Pick<CaptureRuntime, 'setError' | 't'> & {
  setDraft: Dispatch<SetStateAction<CaptureDraft>>;
}): ChooseMedia {
  return async (camera, video, purpose = 'object'): Promise<void> => {
    setError('');
    try {
      if (camera && !(await requestCameraPermissionsAsync()).granted) {
        setError(t('permissionDenied'));

        return;
      }
      const options = {
        mediaTypes: video ? ('videos' as const) : ('images' as const),
        quality: 1 as const,
      };
      const selection = camera
        ? await launchCameraAsync(options)
        : await launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
          });
      if (selection.canceled) {
        return;
      }
      const files = selection.assets.map((asset) => ({
        id: randomUUID(),
        uri: asset.uri,
        name: asset.fileName ?? `antica-${Date.now()}.${video ? 'mp4' : 'jpg'}`,
        mimeType: asset.mimeType ?? (video ? 'video/mp4' : 'image/jpeg'),
        kind: video ? ('video' as const) : ('photo' as const),
        purpose,
        componentLabel: '',
        state: 'local' as const,
        assetId: null,
        checkRequestKey: randomUUID(),
      }));
      setDraft((current) => ({
        ...current,
        files: [...current.files, ...files],
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
}
