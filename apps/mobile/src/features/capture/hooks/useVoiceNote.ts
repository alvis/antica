import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { useState } from 'react';

import type { Dispatch, SetStateAction } from 'react';

import type { CaptureDraft, CaptureRuntime } from './useCaptureDraft';

/** voice-note recording state and the actions that add a voice note */
export interface VoiceNote {
  recording: boolean;
  startVoice: () => Promise<void>;
  stopVoice: () => Promise<void>;
  importVoice: () => Promise<void>;
}

/**
 * records or imports a voice note into the capture draft
 * @param options draft updater, error reporter, and translations
 * @param options.setDraft capture draft updater
 * @param options.setError capture error reporter
 * @param options.t translation function for message keys
 * @returns recording state and voice-note actions
 */
export function useVoiceNote({
  setDraft,
  setError,
  t,
}: Pick<CaptureRuntime, 'setError' | 't'> & {
  setDraft: Dispatch<SetStateAction<CaptureDraft>>;
}): VoiceNote {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const startVoice = async (): Promise<void> => {
    if (!(await requestRecordingPermissionsAsync()).granted) {
      setError(t('permissionDenied'));

      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
  };

  const stopVoice = async (): Promise<void> => {
    await recorder.stop();
    setRecording(false);
    if (recorder.uri) {
      const uri = recorder.uri;
      const file = new File(uri);
      setDraft((current) => ({
        ...current,
        files: [
          ...current.files,
          {
            id: randomUUID(),
            uri,
            name: file.name || 'voice.m4a',
            mimeType: 'audio/mp4',
            kind: 'audio',
            purpose: 'voice_note',
            componentLabel: '',
            state: 'local',
            assetId: null,
          },
        ],
      }));
    }
  };

  const importVoice = async (): Promise<void> => {
    setError('');
    try {
      const selection = await File.pickFileAsync({ mimeTypes: 'audio/*' });
      if (selection.canceled) {
        return;
      }
      const file = selection.result;
      setDraft((current) => ({
        ...current,
        files: [
          ...current.files,
          {
            id: randomUUID(),
            uri: file.uri,
            name: file.name || 'voice.m4a',
            mimeType: file.type || 'audio/mp4',
            kind: 'audio',
            purpose: 'voice_note',
            componentLabel: '',
            state: 'local',
            assetId: null,
          },
        ],
      }));
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  return { recording, startVoice, stopVoice, importVoice };
}
