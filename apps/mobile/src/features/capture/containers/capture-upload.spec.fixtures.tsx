import { expect, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { launchImageLibraryAsync } from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';

import {
  fakeDisk,
  resetFakeDisk,
} from '../../../adapters/file-system.spec.fixtures';
import { uploadMedia } from '../../../adapters/media-upload';
import {
  keepFile,
  listJournals,
  updateJournal,
} from '../../../adapters/upload-journal';
import {
  collectionRecord,
  collectorId,
  renderMobile,
} from '../../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';

export const recordId = collectionRecord.id;
export const firstAsset = '00000000-0000-4000-8000-000000000051';
export const secondAsset = '00000000-0000-4000-8000-000000000052';

/**
 * opens a capture for a new record, imports the given photos, and walks to the save step
 * @param names photo file names in the cache
 * @param journaled whether each photo is expected to get its journal
 * @param deselected grid positions of photos the collector deselects before saving
 * @returns isolated mobile API and navigation boundaries
 */
export async function openSave(
  names: string[],
  journaled = true,
  deselected: number[] = [],
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: names.map((name) => ({
      uri: `file:///cache/${name}`,
      fileName: name,
      mimeType: 'image/jpeg',
      width: 1,
      height: 1,
    })),
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await waitFor(() =>
    expect(listJournals(collectorId).entries).toHaveLength(
      journaled ? names.length : 0,
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  for (const index of deselected) {
    await fireEvent.press(screen.getByTestId(`capture-grid-select-${index}`));
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

  return view;
}

/**
 * keeps a photo of the record in documents, as an earlier session did before the app closed
 * @param id local file identifier
 * @param name photo file name
 * @param state upload state the journal recorded
 */
export async function keptEarlier(
  id: string,
  name: string,
  state: 'uploading' | 'failed',
): Promise<void> {
  fakeDisk().files.set(`file:///cache/${name}`, 'bytes');
  await keepFile(
    {
      id,
      uri: `file:///cache/${name}`,
      name,
      mimeType: 'image/jpeg',
      kind: 'photo',
      purpose: 'object',
      componentLabel: '',
      state: 'local',
      assetId: null,
    },
    { userId: collectorId, recordId, label: 'A-001' },
  );
  updateJournal({ userId: collectorId, recordId }, id, {
    recordLabel: 'A-001',
    componentLabel: '',
    excluded: false,
    state,
    lastErrorCode: state === 'failed' ? 'NETWORK' : null,
  });
}

/**
 * names the files sent to storage, in the order they were sent
 * @returns file names of every upload call so far
 */
export function uploadedNames(): string[] {
  return jest.mocked(uploadMedia).mock.calls.map(([, file]) => file.name);
}

/** empties the fake disk and leaves two photos in its cache, opened without route parameters */
export function resetCapture(): void {
  resetFakeDisk();
  for (const name of ['one.jpg', 'two.jpg']) {
    fakeDisk().files.set(`file:///cache/${name}`, 'bytes');
  }
  jest.mocked(useLocalSearchParams).mockReturnValue({});
}
