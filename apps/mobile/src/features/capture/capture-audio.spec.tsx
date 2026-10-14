import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  requestRecordingPermissionsAsync,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from 'expo-audio';
import { File } from 'expo-file-system';

import type {
  PickMultipleFilesOptions,
  PickMultipleFilesResult,
  PickSingleFileOptions,
  PickSingleFileResult,
} from 'expo-file-system';
import { launchImageLibraryAsync } from 'expo-image-picker';
import { setItemAsync } from 'expo-secure-store';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';
import { uploadMedia } from './media-upload';
import { jobId, transcriptionId, transcript } from './transcript.spec.fixtures';

jest.mock(
  '../../auth',
  () =>
    ({
      useAuth: jest.fn<typeof import('../../auth').useAuth>(),
    }) satisfies Partial<typeof import('../../auth')>,
);
jest.mock(
  './media-upload',
  () =>
    ({
      uploadMedia: jest.fn<typeof uploadMedia>(),
    }) satisfies Partial<typeof import('./media-upload')>,
);
jest.mock(
  'expo-crypto',
  () =>
    ({
      randomUUID:
        jest.requireActual<typeof import('node:crypto')>('node:crypto')
          .randomUUID,
    }) satisfies Partial<typeof import('expo-crypto')>,
);
function mockPickFileAsync() {
  const pickFileMock = jest.fn(async () => ({
    canceled: true as const,
    result: null,
  }));

  function canceledPickFile(
    options?: PickSingleFileOptions,
  ): Promise<PickSingleFileResult>;
  function canceledPickFile(
    options?: PickMultipleFilesOptions,
  ): Promise<PickMultipleFilesResult>;
  function canceledPickFile(
    initialUri?: string,
    mimeType?: string,
  ): Promise<File | File[]>;
  function canceledPickFile(
    _options?: PickSingleFileOptions | PickMultipleFilesOptions | string,
    _mimeType?: string,
  ): Promise<PickSingleFileResult | PickMultipleFilesResult | File | File[]> {
    return pickFileMock();
  }

  return Object.assign(canceledPickFile, pickFileMock);
}

jest.mock('expo-file-system', () => {
  return {
    File: Object.assign(
      jest.fn<(...uris: ConstructorParameters<typeof File>) => File>(
        () => ({ name: '' }) satisfies Partial<File> as File,
      ),
      {
        createDownloadTask: jest.fn<typeof File.createDownloadTask>(),
        downloadFileAsync: jest.fn<typeof File.downloadFileAsync>(),
        pickFileAsync: mockPickFileAsync(),
      },
    ),
  } satisfies Partial<typeof import('expo-file-system')>;
});
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: () => ({}),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => {
  const recorder = {
    prepareToRecordAsync: jest.fn<
      ReturnType<typeof useAudioRecorder>['prepareToRecordAsync']
    >(async () => undefined),
    record: jest.fn<ReturnType<typeof useAudioRecorder>['record']>(),
    stop: jest.fn<ReturnType<typeof useAudioRecorder>['stop']>(
      async () => undefined,
    ),
    get uri(): string | null {
      return 'file:///voice.m4a';
    },
  } satisfies Partial<ReturnType<typeof useAudioRecorder>>;

  return {
    useAudioRecorder: jest.fn<typeof useAudioRecorder>(
      () => recorder as unknown as ReturnType<typeof useAudioRecorder>,
    ),
    requestRecordingPermissionsAsync: jest.fn<
      typeof requestRecordingPermissionsAsync
    >(
      async () =>
        ({ granted: true }) as Awaited<
          ReturnType<typeof requestRecordingPermissionsAsync>
        >,
    ),
    setAudioModeAsync: jest.fn<typeof setAudioModeAsync>(),
    RecordingPresets: {
      HIGH_QUALITY: {} as Parameters<typeof useAudioRecorder>[0],
      LOW_QUALITY: {} as Parameters<typeof useAudioRecorder>[0],
    },
  } satisfies Partial<typeof import('expo-audio')>;
});
jest.mock(
  'expo-image-picker',
  () =>
    ({
      launchImageLibraryAsync: jest.fn<typeof launchImageLibraryAsync>(),
    }) satisfies Partial<typeof import('expo-image-picker')>,
);

const pickAudio = File.pickFileAsync as (options: {
  mimeTypes: string;
}) => Promise<{ canceled: boolean; result: File | null }>;

const recorder = jest.mocked(useAudioRecorder)(RecordingPresets.HIGH_QUALITY);
const recorderMock = jest.mocked(recorder);

/**
 * opens a new capture at its voice-note step
 * @param includePhoto import a photo before the voice note.
 * @returns isolated API and navigation boundaries
 */
async function openAudio(
  includePhoto = false,
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  if (includePhoto) {
    await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

  return view;
}

it('should decline voice recording when microphone permission is denied', async () => {
  jest
    .mocked(requestRecordingPermissionsAsync)
    .mockResolvedValueOnce({ granted: false } as Awaited<
      ReturnType<typeof requestRecordingPermissionsAsync>
    >);
  await openAudio();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Start recording' }),
  );
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(recorderMock.record.mock.calls).toHaveLength(0);
});

it.each([true, false])(
  'should stop recording and offer transcription only when a recording URI exists (%s)',
  async (hasUri) => {
    jest
      .spyOn(recorder, 'uri', 'get')
      .mockReturnValue(hasUri ? 'file:///voice.m4a' : null);
    await openAudio();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Start recording' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Stop recording' }),
      ).toBeTruthy(),
    );
    expect(setAudioModeAsync).toHaveBeenCalledWith({
      allowsRecording: true,
      playsInSilentMode: true,
    });
    expect(recorderMock.prepareToRecordAsync.mock.calls).toHaveLength(1);
    expect(recorderMock.record.mock.calls).toHaveLength(1);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Stop recording' }),
    );
    expect(recorderMock.stop.mock.calls).toHaveLength(1);
    expect(
      Boolean(screen.queryByRole('button', { name: 'Transcribe voice note' })),
    ).toBe(hasUri);
  },
);

it('should import audio with fallback metadata and preserve the uploaded file on transcription retry', async () => {
  jest.mocked(pickAudio).mockResolvedValueOnce({
    canceled: false,
    result: { uri: 'file:///import.m4a', name: '', type: '' } as File,
  });
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce('00000000-0000-4000-8000-000000000044');
  const view = await openAudio();
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  view.commands.mockRejectedValueOnce(
    new Error('Transcription connection lost'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Transcribe voice note' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Transcription connection lost',
    ),
  );
  expect(jest.mocked(uploadMedia).mock.calls[0]?.[1]).toMatchObject({
    name: 'voice.m4a',
    mimeType: 'audio/mp4',
    purpose: 'voice_note',
  });
  view.commands.mockRejectedValueOnce(new Error('Still unavailable'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Transcribe voice note' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Still unavailable'),
  );
  expect(uploadMedia).toHaveBeenCalledTimes(1);
});

it('should leave voice input empty after cancellation and report audio picker failures', async () => {
  await openAudio();
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  expect(
    screen.queryByRole('button', { name: 'Transcribe voice note' }),
  ).toBeNull();
  jest
    .mocked(pickAudio)
    .mockRejectedValueOnce(new Error('Audio picker unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Audio picker unavailable',
    ),
  );
});

it('should surface recorder setup errors and leave recording stopped', async () => {
  recorderMock.prepareToRecordAsync.mockRejectedValueOnce(
    new Error('Recorder unavailable'),
  );
  await openAudio();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Start recording' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Recorder unavailable'),
  );
  expect(screen.queryByRole('button', { name: 'Stop recording' })).toBeNull();
  expect(recorderMock.record.mock.calls).toHaveLength(0);
});

it('should report failure to persist an accepted transcription job', async () => {
  jest.mocked(pickAudio).mockResolvedValueOnce({
    canceled: false,
    result: {
      uri: 'file:///speech.wav',
      name: 'speech.wav',
      type: 'audio/wav',
    } as File,
  });
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce('00000000-0000-4000-8000-000000000044');
  const view = await openAudio();
  view.reads.mockImplementation(async (path) =>
    path.startsWith('/v1/jobs/')
      ? {
          state: { kind: 'failed', error: { message: 'Transcription failed' } },
        }
      : collectionRecord,
  );
  view.commands.mockResolvedValueOnce({ jobId, transcriptionId });
  jest
    .mocked(setItemAsync)
    .mockRejectedValueOnce(new Error('Could not persist transcription job'));
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Transcribe voice note' }),
  );
  await waitFor(() =>
    expect(
      screen.getByText('Could not persist transcription job'),
    ).toBeTruthy(),
  );
  await waitFor(() =>
    expect(screen.getByText('Transcription failed')).toBeTruthy(),
  );
});

it('should persist an accepted transcription and poll until its recovered words are available', async () => {
  jest.mocked(pickAudio).mockResolvedValueOnce({
    canceled: false,
    result: {
      uri: 'file:///speech.wav',
      name: 'speech.wav',
      type: 'audio/wav',
    } as File,
  });
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce('00000000-0000-4000-8000-000000000044');
  const view = await openAudio();
  let jobReads = 0;
  view.reads.mockImplementation(async (path) => {
    if (path.startsWith('/v1/jobs/')) {
      return { state: { kind: ++jobReads === 1 ? 'queued' : 'succeeded' } };
    }
    if (path.startsWith('/v1/transcriptions/')) {
      return transcript;
    }

    return collectionRecord;
  });
  view.commands.mockResolvedValueOnce({ jobId, transcriptionId });
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Transcribe voice note' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Transcribe voice note' }),
    ).toBeDisabled(),
  );
  await waitFor(
    () =>
      expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
        'Recovered words',
      ),
    { timeout: 10000 },
  );
  expect(setItemAsync).toHaveBeenCalledWith(
    `antica.transcriptionJob.${collectionRecord.id}`,
    jobId,
  );
  expect(setItemAsync).toHaveBeenCalledWith(
    `antica.transcription.${collectionRecord.id}`,
    transcriptionId,
  );
  expect(jest.mocked(uploadMedia).mock.calls[0]?.[1]).toMatchObject({
    name: 'speech.wav',
    mimeType: 'audio/wav',
  });
});

it('should retain a local photo while preparing the accompanying voice note', async () => {
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: 'file:///front.jpg',
        fileName: 'front.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  jest.mocked(pickAudio).mockResolvedValueOnce({
    canceled: false,
    result: {
      uri: 'file:///voice.m4a',
      name: 'voice.m4a',
      type: 'audio/mp4',
    } as File,
  });
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce('00000000-0000-4000-8000-000000000044')
    .mockResolvedValueOnce('00000000-0000-4000-8000-000000000045');
  const view = await openAudio(true);
  view.commands.mockResolvedValueOnce({ jobId, transcriptionId });
  view.reads.mockImplementation(async (path) =>
    path.startsWith('/v1/jobs/')
      ? {
          state: {
            kind: 'failed',
            error: { message: 'Transcription unavailable' },
          },
        }
      : collectionRecord,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import audio' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Transcribe voice note' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Transcription unavailable')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  expect(
    jest.mocked(uploadMedia).mock.calls.map(([, file]) => ({
      name: file.name,
      purpose: file.purpose,
    })),
  ).toEqual([
    { name: 'voice.m4a', purpose: 'voice_note' },
    { name: 'front.jpg', purpose: 'object' },
  ]);
  view.client.clear();
});
