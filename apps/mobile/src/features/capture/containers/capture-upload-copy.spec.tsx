import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { File, fakeDisk } from '../../../adapters/file-system.spec.fixtures';
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

it('should wait for a copy still being made when saving starts, so the file uploads once with its journal', async () => {
  let finishCopy: () => void = () => undefined;
  jest
    .spyOn(File.prototype, 'copy')
    .mockImplementationOnce(async function slowCopy(this: File, target) {
      await new Promise<void>((resolve) => {
        finishCopy = resolve;
      });
      fakeDisk().files.set(target.uri, 'bytes');
    });
  jest.mocked(uploadMedia).mockResolvedValueOnce(firstAsset);
  const view = await openSave(['one.jpg'], false);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));

  // the record saved, but the photo waits for its copy rather than racing it
  expect(uploadMedia).not.toHaveBeenCalled();
  await act(async () => finishCopy());

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  const [, sent, , , options] = jest.mocked(uploadMedia).mock.calls[0];
  expect(sent.uri).toMatch(
    new RegExp(`^file:///documents/uploads/${collectorId}/${recordId}/`),
  );
  expect(options?.store).toBeDefined();
  expect(uploadedNames()).toEqual(['one.jpg']);
  // the uploaded file left no journal behind to complete it a second time
  expect(listJournals(collectorId)).toEqual({ entries: [], unreadable: [] });
  await screen.unmount();
  expect(unfinishedUploads(collectorId)).toEqual([]);
  view.client.clear();
});

it('should delete the copies of deselected files once the record saved', async () => {
  jest.mocked(uploadMedia).mockResolvedValueOnce(firstAsset);
  const view = await openSave(['one.jpg', 'two.jpg'], true, [2]);
  expect(listJournals(collectorId).entries).toHaveLength(2);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/collection/${recordId}`),
  );
  expect(uploadedNames()).toEqual(['one.jpg']);
  expect(listJournals(collectorId)).toEqual({ entries: [], unreadable: [] });
  expect(
    [...fakeDisk().files.keys()].filter((uri) => uri.includes('/documents/')),
  ).toEqual([]);
  view.client.clear();
});
