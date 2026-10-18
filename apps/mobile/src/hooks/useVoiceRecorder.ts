import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';

import { useState } from 'react';

/** microphone recording state and the actions that start and finish a recording */
export interface VoiceRecorder {
  recording: boolean;
  /** asks for microphone permission and starts recording; resolves false when permission is denied */
  start: () => Promise<boolean>;
  /** stops recording; resolves the recorded file URI, or null when nothing was recorded */
  stop: () => Promise<string | null>;
}

/**
 * records audio from the microphone at the shared voice-note quality
 * @returns recording state and the start and stop actions
 */
export function useVoiceRecorder(): VoiceRecorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);

  const start = async (): Promise<boolean> => {
    if (!(await requestRecordingPermissionsAsync()).granted) {
      return false;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);

    return true;
  };

  const stop = async (): Promise<string | null> => {
    await recorder.stop();
    setRecording(false);

    return recorder.uri;
  };

  return { recording, start, stop };
}
