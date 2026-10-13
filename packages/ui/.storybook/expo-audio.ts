/** Browser-safe recording preset used by mobile stories. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors Expo's public API
export const RecordingPresets = { HIGH_QUALITY: {} } as const;

/**
 * Returns a recorder that remains idle until a native device is used.
 * @returns Inert browser recorder controls.
 */
export function useAudioRecorder(): {
  uri: null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
} {
  return {
    uri: null,
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  };
}

/**
 * Reports unavailable native microphone permission in the browser fixture.
 * @returns A denied microphone permission result.
 */
export async function requestRecordingPermissionsAsync(): Promise<{
  granted: false;
}> {
  return { granted: false };
}

/**
 * Accepts the native audio-mode request without changing browser state.
 * @returns Completion of the inert mode update.
 */
export async function setAudioModeAsync(): Promise<void> {
  return undefined;
}
