import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { requestRecordingPermissionsAsync } from 'expo-audio';

import { uploadMedia } from '../../../../adapters/media-upload';
import RecordMessagesRoute from '../../../../app/(private)/collection/[recordId]/messages';
import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';

import {
  postInProgressFirstDelayMs,
  postInProgressRetries,
} from '../api/record-messages';

import {
  apiError,
  inProgress,
  messagesPath,
  page,
  recordId,
  sentTo,
} from './record-messages.spec.fixtures';

import type { MobileHarness } from '../../../../mobile.spec.fixtures';

jest.mock(
  '../../../../providers/AuthProvider',
  () =>
    ({
      useAuth:
        jest.fn<typeof import('../../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: jest.fn<
        typeof import('expo-router').useLocalSearchParams
      >(() => ({ recordId: '00000000-0000-4000-8000-000000000001' })),
    }) satisfies Partial<typeof import('expo-router')>,
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
    uri: 'file:///voice-message.m4a' as string | null,
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  };

  return {
    useAudioRecorder: () => recorder,
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    RecordingPresets: { HIGH_QUALITY: {} },
    recorder,
  };
});
jest.mock(
  '../../../../adapters/media-upload',
  () =>
    ({
      uploadMedia:
        jest.fn<
          typeof import('../../../../adapters/media-upload').uploadMedia
        >(),
    }) satisfies Partial<typeof import('../../../../adapters/media-upload')>,
);

const transcriptionId = '00000000-0000-4000-8000-000000000521';
const jobId = '00000000-0000-4000-8000-000000000522';
const audioAssetId = '00000000-0000-4000-8000-000000000523';
const transcript = {
  transcriptionId,
  jobId,
  revision: 2,
  status: 'ready',
  result: {
    transcriptionId,
    originalText: 'Spoken words',
    readingTextZhHant: 'Recovered words',
  },
};
const { recorder } = jest.requireMock<{
  recorder: { uri: string | null };
}>('expo-audio');

/**
 * answers record, thread, job, and transcription reads
 * @param job state of the transcription job
 * @param words transcription detail returned once the job finished
 * @returns a read handler for the harness
 */
function reads(
  job = 'succeeded',
  words = transcript,
): (path: string) => Promise<unknown> {
  return async (path) =>
    path === `/v1/records/${recordId}`
      ? collectionRecord
      : path === `/v1/jobs/${jobId}`
        ? { state: { kind: job } }
        : path === `/v1/transcriptions/${transcriptionId}`
          ? words
          : page([]);
}

/**
 * counts reads of the shown record
 * @param view rendered message area
 * @returns number of record reads so far
 */
function recordReads(view: MobileHarness): number {
  return view.reads.mock.calls.filter(
    ([path]) => path === `/v1/records/${recordId}`,
  ).length;
}

/**
 * types a message and presses Send
 * @param text message to type
 */
async function typeAndSend(text: string): Promise<void> {
  await fireEvent.changeText(
    await screen.findByTestId('record-message-input'),
    text,
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
}

/**
 * records a voice message and waits for its transcript in the input
 * @param view rendered message area
 */
async function speak(view: MobileHarness): Promise<void> {
  jest.mocked(uploadMedia).mockResolvedValueOnce(audioAssetId);
  view.commands.mockImplementation(async (path) =>
    path === '/v1/transcriptions' ? { jobId, transcriptionId } : {},
  );
  await fireEvent.press(await screen.findByTestId('record-message-voice'));
  expect(screen.getByTestId('record-message-voice')).toHaveAccessibleName(
    'Stop and transcribe',
  );
  expect(screen.getByTestId('record-message-voice-status')).toHaveTextContent(
    'Recording…',
  );
  await fireEvent.press(screen.getByTestId('record-message-voice'));
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
      'Recovered words',
    ),
  );
  expect(screen.getByTestId('record-message-voice-status')).toHaveTextContent(
    'Check the transcribed words, then send.',
  );
}

it('should post typed text once per send with a fresh request key and the shown revision', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: reads(),
    post: async () => ({}),
  });

  expect(
    await screen.findByTestId('record-message-input'),
  ).toHaveAccessibleName('Message to the assistant');
  await fireEvent.changeText(screen.getByTestId('record-message-input'), '   ');
  // blank text offers voice, never a send
  expect(screen.queryByTestId('record-message-send')).toBeNull();
  expect(screen.getByTestId('record-message-voice')).toBeEnabled();
  await typeAndSend('  Is this Kangxi?  ');
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );
  await typeAndSend('And the mark?');
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(2));

  const posts = sentTo(view.commands, messagesPath);
  expect(posts[0]?.body).toEqual({
    requestKey: posts[0]?.idempotencyKey,
    body: 'Is this Kangxi?',
    transcriptionIds: [],
    expectedRecordRevision: collectionRecord.recordRevision,
  });
  expect(posts[1]?.body.requestKey).not.toBe(posts[0]?.body.requestKey);
});

it('should cap the message at the contract length', async () => {
  await renderMobile(<RecordMessagesRoute />, { get: reads() });

  await fireEvent.changeText(
    await screen.findByTestId('record-message-input'),
    'x'.repeat(2100),
  );

  expect(screen.getByTestId('record-message-input').props.value).toHaveLength(
    2000,
  );
});

it('should retry an in-flight request key until the server stores the message', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  view.commands
    .mockRejectedValueOnce(inProgress)
    .mockRejectedValueOnce(inProgress)
    .mockResolvedValueOnce({});

  await typeAndSend('Retry me');
  await waitFor(
    () =>
      expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
    { timeout: 5000 },
  );

  const keys = sentTo(view.commands, messagesPath).map(
    ({ idempotencyKey }) => idempotencyKey,
  );
  expect(keys).toHaveLength(3);
  expect(new Set(keys).size).toBe(1);
  expect(screen.queryByTestId('record-message-error')).toBeNull();
});

it('should keep the request key and say it is still sending when the server stays busy', async () => {
  jest.useFakeTimers();
  try {
    const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
    view.commands.mockRejectedValue(inProgress);

    await typeAndSend('Busy');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(postInProgressFirstDelayMs * 16);
    });
    expect(screen.getByTestId('record-message-error')).toHaveTextContent(
      'This is still being sent. Try again in a moment.',
    );
    view.commands.mockResolvedValue({});
    await fireEvent.press(screen.getByTestId('record-message-send'));
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue('');

    const keys = sentTo(view.commands, messagesPath).map(
      ({ idempotencyKey }) => idempotencyKey,
    );
    expect(keys).toHaveLength(postInProgressRetries + 2);
    expect(new Set(keys).size).toBe(1);
  } finally {
    jest.useRealTimers();
  }
});

it('should drop a stale post at once, reload the record, and use a new key next time', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  view.commands.mockRejectedValueOnce(
    apiError(409, 'REVISION_CONFLICT', 'Record changed before edit request'),
  );
  await screen.findByTestId('record-message-input');
  const before = recordReads(view);

  await typeAndSend('Stale');
  expect(await screen.findByTestId('record-message-error')).toHaveTextContent(
    'The item changed after this screen loaded. It has been reloaded; send again.',
  );
  await waitFor(() => expect(recordReads(view)).toBeGreaterThan(before));
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );

  const keys = sentTo(view.commands, messagesPath).map(
    ({ idempotencyKey }) => idempotencyKey,
  );
  expect(keys).toHaveLength(2);
  expect(keys[1]).not.toBe(keys[0]);
});

it('should reuse the request key when a network failure interrupts the same send', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  view.commands.mockRejectedValueOnce(new TypeError('Network request failed'));

  await typeAndSend('Hello');
  expect(await screen.findByTestId('record-message-error')).toHaveTextContent(
    'Connect to the internet and retry.',
  );
  view.commands.mockRejectedValueOnce(new TypeError('Network request failed'));
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(2),
  );
  view.commands.mockResolvedValue({});
  await typeAndSend('Hello again');
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );

  const keys = sentTo(view.commands, messagesPath).map(
    ({ idempotencyKey }) => idempotencyKey,
  );
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

it('should post reviewed speech with its ready transcription and the revision on screen', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  await speak(view);

  const readsBeforeSend = recordReads(view);
  await typeAndSend('Recovered words, corrected');
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );

  expect(jest.mocked(uploadMedia).mock.calls[0]?.[1]).toMatchObject({
    kind: 'audio',
    purpose: 'voice_note',
    uri: 'file:///voice-message.m4a',
  });
  expect(jest.mocked(uploadMedia).mock.calls[0]?.[2]).toEqual({
    kind: 'record',
    id: recordId,
  });
  expect(sentTo(view.commands, '/v1/transcriptions')[0]?.body).toMatchObject({
    recordId,
    audioAssetId,
    expectedRecordRevision: collectionRecord.recordRevision,
  });
  // sending neither confirms the transcription nor rereads the record
  expect(
    view.commands.mock.calls.filter(([path]) => path.endsWith('/confirm')),
  ).toHaveLength(0);
  expect(recordReads(view)).toBe(readsBeforeSend);
  expect(sentTo(view.commands, messagesPath)).toEqual([
    {
      body: {
        requestKey: expect.any(String),
        body: 'Recovered words, corrected',
        transcriptionIds: [transcriptionId],
        expectedRecordRevision: collectionRecord.recordRevision,
      },
      idempotencyKey: expect.any(String),
    },
  ]);
  expect(screen.queryByTestId('record-message-voice-status')).toBeNull();
});

it('should offer a new recording after the collector clears a ready transcript', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  await speak(view);
  await fireEvent.changeText(screen.getByTestId('record-message-input'), '');

  expect(screen.queryByTestId('record-message-send')).toBeNull();
  expect(screen.getByTestId('record-message-voice')).toBeEnabled();
  await fireEvent.press(screen.getByTestId('record-message-voice'));
  expect(screen.getByTestId('record-message-voice')).toHaveAccessibleName(
    'Stop and transcribe',
  );
  expect(sentTo(view.commands, messagesPath)).toHaveLength(0);
});

it('should repeat an interrupted spoken message under its key and rebuild it once the words change', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  await speak(view);
  view.commands
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockRejectedValueOnce(new TypeError('Network request failed'));

  await fireEvent.press(screen.getByTestId('record-message-send'));
  expect(await screen.findByTestId('record-message-error')).toHaveTextContent(
    'Connect to the internet and retry.',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(2),
  );
  await typeAndSend('Recovered words, edited');
  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(''),
  );

  const [first, repeated, rebuilt] = sentTo(view.commands, messagesPath);
  expect(repeated.idempotencyKey).toBe(first.idempotencyKey);
  expect(rebuilt.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(rebuilt.body).toMatchObject({
    body: 'Recovered words, edited',
    transcriptionIds: [transcriptionId],
  });
});

it('should explain a denied microphone and an empty recording', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, { get: reads() });
  jest
    .mocked(requestRecordingPermissionsAsync)
    .mockResolvedValueOnce({ granted: false } as Awaited<
      ReturnType<typeof requestRecordingPermissionsAsync>
    >);

  await fireEvent.press(await screen.findByTestId('record-message-voice'));

  expect(screen.getByTestId('record-message-error')).toHaveTextContent(
    'Permission was denied. You can import a file instead.',
  );
  recorder.uri = null;
  try {
    await fireEvent.press(screen.getByTestId('record-message-voice'));
    await fireEvent.press(screen.getByTestId('record-message-voice'));
  } finally {
    recorder.uri = 'file:///voice-message.m4a';
  }
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(view.commands).not.toHaveBeenCalled();
});

it('should report an upload failure and a failed transcription job', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: reads('failed'),
  });
  jest
    .mocked(uploadMedia)
    .mockRejectedValueOnce(apiError(409, 'UPLOAD_INCOMPLETE', 'Parts missing'));

  await fireEvent.press(await screen.findByTestId('record-message-voice'));
  await fireEvent.press(screen.getByTestId('record-message-voice'));
  expect(await screen.findByTestId('record-message-error')).toHaveTextContent(
    'This file did not upload. Retry this file.',
  );
  expect(screen.getByTestId('record-message-voice')).toBeEnabled();

  jest.mocked(uploadMedia).mockResolvedValueOnce(audioAssetId);
  view.commands.mockResolvedValue({ jobId, transcriptionId });
  await fireEvent.press(screen.getByTestId('record-message-voice'));
  await fireEvent.press(screen.getByTestId('record-message-voice'));

  await waitFor(() =>
    expect(screen.getByTestId('record-message-voice-status')).toHaveTextContent(
      'The recording could not be transcribed. Type the message or record again.',
    ),
  );
  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue('');
});

it('should fall back to the original transcript when no reading text exists', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: reads('partial', {
      ...transcript,
      result: { ...transcript.result, readingTextZhHant: '' },
    }),
  });
  jest.mocked(uploadMedia).mockResolvedValueOnce(audioAssetId);
  view.commands.mockResolvedValue({ jobId, transcriptionId });

  await fireEvent.press(await screen.findByTestId('record-message-voice'));
  await fireEvent.press(screen.getByTestId('record-message-voice'));

  await waitFor(() =>
    expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
      'Spoken words',
    ),
  );
});

it('should lock the composer while the recording is transcribed', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: reads('running'),
  });
  jest.mocked(uploadMedia).mockResolvedValueOnce(audioAssetId);
  view.commands.mockResolvedValue({ jobId, transcriptionId });

  await fireEvent.press(await screen.findByTestId('record-message-voice'));
  await fireEvent.press(screen.getByTestId('record-message-voice'));

  await waitFor(() =>
    expect(screen.getByTestId('record-message-voice-status')).toHaveTextContent(
      'Transcribing your voice…',
    ),
  );
  expect(screen.queryByTestId('record-message-send')).toBeNull();
  expect(screen.getByTestId('record-message-voice')).toBeDisabled();
  expect(screen.getByTestId('record-message-input').props.editable).toBe(false);
});
