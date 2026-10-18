import { expect, it, jest } from '@jest/globals';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { getItemAsync } from 'expo-secure-store';

import {
  recordDetailSchema,
  transcriptionConfirmedSchema,
} from '@antica/contracts';

import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';
import { transcript, transcriptionId, jobId } from './transcript.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

const nextRecord = recordDetailSchema.parse({
  ...collectionRecord,
  id: '00000000-0000-4000-8000-000000000099',
  code: 'A-099',
  name: 'Newly selected vase',
});

it.each(['response', 'failure'])(
  'should keep the newly selected capture record when an earlier record %s arrives late',
  async (outcome) => {
    const previous = Promise.withResolvers<unknown>();
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ recordId: collectionRecord.id });
    const view = await renderMobile(<CaptureContainer />, {
      get: async (path) =>
        path === '/v1/locations'
          ? []
          : path.endsWith(collectionRecord.id)
            ? previous.promise
            : nextRecord,
    });
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ recordId: nextRecord.id });
    await screen.rerender(
      <QueryClientProvider client={view.client}>
        <LocaleProvider>
          <CaptureContainer />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(nextRecord.code)).toBeTruthy());
    await act(async () => {
      if (outcome === 'response') {
        previous.resolve(collectionRecord);
      } else {
        previous.reject(new Error('Previous record unavailable'));
      }
    });
    expect(screen.getByText(nextRecord.code)).toBeTruthy();
    expect(screen.queryByText(collectionRecord.code)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    view.client.clear();
  },
);

it('should not restore another record voice notes after navigating during secure-storage recovery', async () => {
  const previous = Promise.withResolvers<string | null>();
  jest.mocked(getItemAsync).mockImplementation(async (key) => {
    if (key === `antica.transcriptionJob.${collectionRecord.id}`) {
      return previous.promise;
    }
    if (key === `antica.transcription.${collectionRecord.id}`) {
      return transcriptionId;
    }

    return null;
  });
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path === '/v1/locations'
        ? []
        : path.startsWith('/v1/transcriptions/')
          ? transcript
          : path.startsWith('/v1/jobs/')
            ? { state: { kind: 'succeeded' } }
            : path.endsWith(collectionRecord.id)
              ? collectionRecord
              : nextRecord,
  });
  await waitFor(() =>
    expect(screen.getByText(collectionRecord.code)).toBeTruthy(),
  );
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: nextRecord.id });
  await screen.rerender(
    <QueryClientProvider client={view.client}>
      <LocaleProvider>
        <CaptureContainer />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(screen.getByText(nextRecord.code)).toBeTruthy());
  await act(async () => previous.resolve(jobId));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByLabelText('Original words')).toHaveDisplayValue('');
  expect(view.reads.mock.calls.map(([path]) => path)).not.toContain(
    `/v1/jobs/${jobId}`,
  );
  view.client.clear();
});

it('should retain the current check when confirming a recovered voice transcription', async () => {
  const checkId = '00000000-0000-4000-8000-000000000088';
  const observationId = '00000000-0000-4000-8000-000000000087';
  const confirmed = transcriptionConfirmedSchema.parse({
    transcription: {
      ...transcript,
      confirmedObservationId: observationId,
      revision: 3,
    },
    observation: {
      id: observationId,
      recordId: collectionRecord.id,
      componentIds: [],
      channel: 'voice',
      text: 'Recovered words',
      evidenceAnchorIds: [],
      checkIds: [checkId],
      observedAt: collectionRecord.createdAt,
      voice: {
        audioAssetId: transcript.snapshot.audioAssetId,
        transcriptionId,
        segmentId: null,
      },
      editDraftId: null,
      supersedesObservationId: null,
      author: 'collector',
      createdAt: collectionRecord.createdAt,
      supersededByObservationId: null,
    },
    versions: {
      recordRevision: 2,
      analysisInputVersion: 2,
      evidenceVersion: 1,
    },
  });
  jest
    .mocked(getItemAsync)
    .mockImplementation(async (key) =>
      key.includes('transcriptionJob.')
        ? jobId
        : key.includes('transcription.')
          ? transcriptionId
          : null,
    );
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id, checkId });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path === '/v1/locations'
        ? []
        : path.startsWith('/v1/jobs/')
          ? { state: { kind: 'succeeded' } }
          : path.startsWith('/v1/transcriptions/')
            ? transcript
            : collectionRecord,
    post: async () => confirmed,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
      'Recovered words',
    ),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  expect(view.commands.mock.calls[0]?.[2].body).toMatchObject({
    adoptedTextZhHant: 'Recovered words',
    checkIds: [checkId],
  });
  view.client.clear();
});
