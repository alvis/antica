import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { setItemAsync } from 'expo-secure-store';

import { renderMobile } from '../../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';
import {
  transcriptionId,
  editDraftId,
  jobId,
  observationId,
  transcript,
  editing,
  readCapture,
  submitCapture,
} from './transcript.spec.fixtures';

import type { getItemAsync } from 'expo-secure-store';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({
  uploadMedia: jest.fn(async () => '00000000-0000-4000-8000-000000000044'),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({
    recordId: '00000000-0000-4000-8000-000000000001',
  }),
}));
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: async (key) =>
        key.includes('transcriptionJob.') || key.includes('editJob.')
          ? '00000000-0000-4000-8000-000000000041'
          : key.includes('transcription.')
            ? '00000000-0000-4000-8000-000000000040'
            : key.includes('editDraft.')
              ? '00000000-0000-4000-8000-000000000042'
              : null,
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///vase.jpg', fileName: 'vase.jpg', mimeType: 'image/jpeg' },
    ],
  }),
}));

const secureStore = jest.requireMock<{ getItemAsync: typeof getItemAsync }>(
  'expo-secure-store',
);

/** opens the restored voice-note step */
async function openWords(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}

it('should explain a failed existing-record load', async () => {
  await renderMobile(<CaptureContainer />, {
    get: async (path) => {
      if (path.startsWith('/v1/records/')) {
        throw new Error('Record unavailable');
      }

      return [];
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Record unavailable'),
  );
});

it('should refuse confirming a restored transcription that is still pending', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path.startsWith('/v1/transcriptions/')
        ? { ...transcript, status: 'pending', result: null }
        : readCapture(path),
  });
  await openWords();
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    'Collector correction',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Processing'),
  );
  expect(view.commands).not.toHaveBeenCalled();
});

it('should show both restored job failures without silently retrying them', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path.startsWith('/v1/jobs/')
        ? {
            state: {
              kind: 'failed',
              error: { message: 'Provider unavailable' },
            },
          }
        : readCapture(path),
  });
  await openWords();
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  for (const alert of screen.getAllByRole('alert')) {
    expect(alert).toHaveTextContent('Provider unavailable');
  }
  expect(view.commands).not.toHaveBeenCalled();
});

it('should poll a restored editing job until the prepared description arrives', async () => {
  const editingJobId = '00000000-0000-4000-8000-000000000047';
  jest
    .spyOn(secureStore, 'getItemAsync')
    .mockImplementation(async (key) =>
      key.includes('editJob.')
        ? editingJobId
        : key.includes('editDraft.')
          ? editDraftId
          : null,
    );
  let reads = 0;
  await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path === `/v1/jobs/${editingJobId}`
        ? { state: { kind: ++reads === 1 ? 'running' : 'succeeded' } }
        : readCapture(path),
  });
  await openWords();
  await waitFor(
    () =>
      expect(screen.getByLabelText('Prepared description')).toHaveDisplayValue(
        editing.result!.suggestedDescriptionZhHant,
      ),
    { timeout: 10000 },
  );
});

it('should restore confirmed words and a persisted edit draft without resubmitting either', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path.startsWith('/v1/transcriptions/')
        ? {
            ...transcript,
            confirmedObservationId: observationId,
            result: { ...transcript.result!, readingTextZhHant: '' },
          }
        : readCapture(path),
  });
  await openWords();
  await waitFor(() =>
    expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
      'Recorded words',
    ),
  );
  expect(
    screen.getByRole('button', { name: 'Original words confirmed' }),
  ).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByLabelText('Prepared description')).toHaveDisplayValue(
      editing.result!.suggestedDescriptionZhHant,
    ),
  );
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getAllByRole('button', { name: 'Select proposal' })[0],
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Proposal selected' }),
  );
  expect(
    screen.queryByRole('button', { name: 'Apply selected changes (1)' }),
  ).toBeNull();
});

it('should surface a persisted job restoration failure', async () => {
  jest.spyOn(secureStore, 'getItemAsync').mockImplementation(async (key) => {
    if (key.includes('transcriptionJob.')) {
      throw new Error('Secure storage unavailable');
    }

    return null;
  });
  await renderMobile(<CaptureContainer />, { get: readCapture });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Secure storage unavailable',
    ),
  );
});

it('should report description preparation failures and retain recovered text', async () => {
  jest
    .spyOn(secureStore, 'getItemAsync')
    .mockImplementation(async (key) =>
      key.includes('transcriptionJob.')
        ? jobId
        : key.includes('transcription.')
          ? transcriptionId
          : null,
    );
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path.startsWith('/v1/transcriptions/')
        ? { ...transcript, confirmedObservationId: observationId }
        : readCapture(path),
    post: submitCapture,
  });
  await openWords();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare description' }),
    ).toBeEnabled(),
  );
  view.commands.mockRejectedValueOnce(new Error('Preparation offline'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare description' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Preparation offline'),
  );
  expect(screen.getByLabelText('Original words')).toHaveDisplayValue(
    'Recovered words',
  );
  jest
    .mocked(setItemAsync)
    .mockRejectedValueOnce(new Error('Could not persist description job'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare description' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not persist description job',
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Prepared description')).toHaveDisplayValue(
      editing.result!.suggestedDescriptionZhHant,
    ),
  );
});
