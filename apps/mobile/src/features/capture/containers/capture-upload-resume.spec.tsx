import { beforeEach, expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { ApiError } from '@antica/client';

import { fakeDisk } from '../../../adapters/file-system.spec.fixtures';
import { uploadMedia } from '../../../adapters/media-upload';
import { listJournals, updateJournal } from '../../../adapters/upload-journal';
import {
  collectionRecord,
  collectorId,
  renderMobile,
} from '../../../mobile.spec.fixtures';

import {
  firstAsset,
  keptEarlier,
  recordId,
  resetCapture,
  secondAsset,
} from './capture-upload.spec.fixtures';
import { CaptureContainer } from './CaptureContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({
  ...jest.requireActual<typeof import('../../../adapters/media-upload')>(
    '../../../adapters/media-upload',
  ),
  uploadMedia: jest.fn(),
}));
jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
}));

beforeEach(resetCapture);

it('should continue the unfinished files of a record only when the collector resumes', async () => {
  await keptEarlier(
    '00000000-0000-4000-8000-000000000101',
    'front.jpg',
    'uploading',
  );
  await keptEarlier(
    '00000000-0000-4000-8000-000000000102',
    'base.jpg',
    'failed',
  );
  await keptEarlier(
    '00000000-0000-4000-8000-000000000103',
    'blurred.jpg',
    'failed',
  );
  updateJournal(
    { userId: collectorId, recordId },
    '00000000-0000-4000-8000-000000000103',
    {
      recordLabel: 'A-001',
      componentLabel: '',
      excluded: true,
      state: 'local',
      lastErrorCode: null,
    },
  );
  jest.mocked(useLocalSearchParams).mockReturnValue({ recordId, resume: '1' });
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce(firstAsset)
    .mockResolvedValueOnce(secondAsset);
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  expect(
    jest
      .mocked(uploadMedia)
      .mock.calls.map(([, file]) => file.name)
      .sort(),
  ).toEqual(['base.jpg', 'front.jpg']);
  // resuming only uploads: the record's fields were saved before the app closed
  expect(view.patches).not.toHaveBeenCalled();
  // the deselected file never uploads, so its copy goes once the others did
  expect(listJournals(collectorId)).toEqual({ entries: [], unreadable: [] });
  view.client.clear();
});

it('should upload restored files even after the record changed elsewhere, without a photo gate', async () => {
  await keptEarlier(
    '00000000-0000-4000-8000-000000000101',
    'receipt.jpg',
    'uploading',
  );
  // a receipt alone would never pass Save's object-photo requirement
  const journal = `file:///documents/uploads/${collectorId}/${recordId}/00000000-0000-4000-8000-000000000101/journal.json`;
  const { files } = fakeDisk();
  files.set(
    journal,
    JSON.stringify({
      ...(JSON.parse(String(files.get(journal))) as object),
      purpose: 'receipt',
    }),
  );
  jest.mocked(useLocalSearchParams).mockReturnValue({ recordId, resume: '1' });
  jest.mocked(uploadMedia).mockResolvedValueOnce(firstAsset);
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path === '/v1/locations'
        ? []
        : { ...collectionRecord, recordRevision: 7, mediaIds: [] },
    patch: async () => {
      throw new ApiError({
        status: 409,
        code: 'REVISION_CONFLICT',
        message: 'The record changed elsewhere.',
      });
    },
  });

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  expect(uploadMedia).toHaveBeenCalledTimes(1);
  expect(view.patches).not.toHaveBeenCalled();
  expect(
    screen.queryByText('Add and upload at least one object photo.'),
  ).toBeNull();
  view.client.clear();
});

it('should keep a resumed file that failed again on the save step with its retry', async () => {
  await keptEarlier(
    '00000000-0000-4000-8000-000000000101',
    'front.jpg',
    'uploading',
  );
  jest.mocked(useLocalSearchParams).mockReturnValue({ recordId, resume: '1' });
  jest.mocked(uploadMedia).mockRejectedValueOnce(new TypeError('offline'));
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });

  await waitFor(() =>
    expect(screen.getByTestId('capture-file-state-1')).toHaveTextContent(
      /Not uploaded/,
    ),
  );
  expect(view.router.replace).not.toHaveBeenCalled();
  expect(listJournals(collectorId).entries).toMatchObject([
    { name: 'front.jpg', state: 'failed', lastErrorCode: 'NETWORK' },
  ]);
  view.client.clear();
});

it('should open a record with unfinished files without uploading them unasked', async () => {
  await keptEarlier(
    '00000000-0000-4000-8000-000000000101',
    'front.jpg',
    'uploading',
  );
  jest.mocked(useLocalSearchParams).mockReturnValue({ recordId });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  expect(uploadMedia).not.toHaveBeenCalled();
  await screen.unmount();

  // files from an earlier session are never deleted by a draft that did not restore them
  expect(listJournals(collectorId).entries).toHaveLength(1);
  view.client.clear();
});

it('should leave the save step for the collector when nothing is left to resume', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ recordId, resume: '1' });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy(),
  );
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
  view.client.clear();
});
