import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@antica/client';

import { fakeDisk } from '../../../adapters/file-system.spec.fixtures';
import { uploadMedia } from '../../../adapters/media-upload';
import {
  listJournals,
  unfinishedUploads,
} from '../../../adapters/upload-journal';
import { collectorId } from '../../../mobile.spec.fixtures';

import {
  firstAsset,
  openSave,
  recordId,
  resetCapture,
  secondAsset,
  uploadedNames,
} from './capture-upload.spec.fixtures';

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

it('should keep each added photo in documents and delete the copies of a draft left unsaved', async () => {
  const view = await openSave(['one.jpg', 'two.jpg']);

  expect(
    listJournals(collectorId)
      .entries.map((entry) => entry.name)
      .sort(),
  ).toEqual(['one.jpg', 'two.jpg']);
  // an open draft is uploading on screen, so it is never offered for resumption
  expect(unfinishedUploads(collectorId)).toEqual([]);
  await screen.unmount();

  expect(listJournals(collectorId).entries).toEqual([]);
  expect(uploadMedia).not.toHaveBeenCalled();
  view.client.clear();
});

it('should show each file uploading, retry the one that failed, and never call it saved', async () => {
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce(firstAsset)
    .mockRejectedValueOnce(new TypeError('Network request failed'))
    .mockResolvedValueOnce(secondAsset);
  const view = await openSave(['one.jpg', 'two.jpg']);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(screen.getByTestId('capture-file-state-2')).toHaveTextContent(
      'two.jpg: Not uploaded — No connection. The file is kept on this device.',
    ),
  );
  expect(screen.getByTestId('capture-file-state-1')).toHaveTextContent(
    'one.jpg: Uploaded',
  );
  expect(screen.queryByTestId('capture-file-retry-1')).toBeNull();
  expect(screen.queryByTestId('capture-retry-all')).toBeNull();
  expect(view.router.replace).not.toHaveBeenCalled();
  expect(listJournals(collectorId).entries).toMatchObject([
    { name: 'two.jpg', state: 'failed', lastErrorCode: 'NETWORK' },
  ]);
  const [, sent, , , options] = jest.mocked(uploadMedia).mock.calls[1];
  expect(sent.uri).toBe(listJournals(collectorId).entries[0]?.copyUri);
  expect(options!.store?.load()).toMatchObject({
    requestKey: sent.id,
  });

  await fireEvent.press(screen.getByRole('button', { name: 'Retry two.jpg' }));
  await waitFor(() =>
    expect(screen.getByTestId('capture-file-state-2')).toHaveTextContent(
      'two.jpg: Uploaded',
    ),
  );
  // the retry sends the failed file alone, and saving afterwards sends nothing again
  const sentNames = ['one.jpg', 'two.jpg', 'two.jpg'];
  expect(uploadedNames()).toEqual(sentNames);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  expect(uploadedNames()).toEqual(sentNames);
  expect(listJournals(collectorId).entries).toEqual([]);
  view.client.clear();
});

it('should offer to retry every failed file once two failed, keeping them after the draft closes', async () => {
  jest
    .mocked(uploadMedia)
    .mockRejectedValueOnce(
      new ApiError({ status: 409, code: 'UPLOAD_FAILED', message: 'bad' }),
    )
    .mockRejectedValueOnce(
      new ApiError({
        status: 404,
        code: 'NOT_FOUND',
        message: 'Media not found',
      }),
    )
    .mockRejectedValueOnce(new Error('Disk unavailable'))
    .mockResolvedValueOnce(secondAsset);
  const view = await openSave(['one.jpg', 'two.jpg']);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(
      screen.getByRole('button', {
        name: 'Retry 2 files that did not upload',
      }),
    ).toBeTruthy(),
  );
  expect(screen.getByTestId('capture-file-state-1')).toHaveTextContent(
    'one.jpg: Not uploaded — The file could not be verified. Retry it.',
  );
  expect(screen.getByTestId('capture-file-state-2')).toHaveTextContent(
    'two.jpg: Not uploaded — Media not found',
  );
  await fireEvent.press(screen.getByTestId('capture-retry-all'));
  await waitFor(() =>
    expect(screen.getByTestId('capture-file-state-1')).toHaveTextContent(
      'one.jpg: Not uploaded — Disk unavailable',
    ),
  );
  expect(screen.getByTestId('capture-file-state-2')).toHaveTextContent(
    'two.jpg: Uploaded',
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'This file did not upload. Retry this file.',
  );
  await screen.unmount();

  // the collector asked to save, so the file that did not upload waits for a resume
  expect(unfinishedUploads(collectorId)).toEqual([
    { userId: collectorId, recordId, recordLabel: 'A-001', count: 1 },
  ]);
  view.client.clear();
});

it('should announce the parts stored so far while a file uploads', async () => {
  const progress = { uploaded: 3, total: 5 };
  let release!: (assetId: string) => void;
  const stored = new Promise<string>((resolve) => {
    release = resolve;
  });
  jest
    .mocked(uploadMedia)
    .mockImplementationOnce(async (...[, , , , options]) => {
      options?.onProgress?.(progress.uploaded, progress.total);

      return stored;
    });
  const view = await openSave(['one.jpg']);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  const state = await screen.findByText('one.jpg: Uploading 3/5');
  expect(state).toHaveAccessibilityValue({
    min: 0,
    max: progress.total,
    now: progress.uploaded,
  });
  expect(state).toBeBusy();
  expect(state.props.accessibilityRole).toBe('progressbar');
  release(firstAsset);
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  view.client.clear();
});

it('should upload without restart protection when no copy can be kept', async () => {
  fakeDisk().failing.add('copy');
  jest.mocked(uploadMedia).mockResolvedValueOnce(firstAsset);
  const view = await openSave(['one.jpg'], false);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  const [, sent, , , options] = jest.mocked(uploadMedia).mock.calls[0];
  expect(sent.uri).toBe('file:///cache/one.jpg');
  expect(options).toMatchObject({ store: undefined });
  view.client.clear();
});
