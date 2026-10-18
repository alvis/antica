import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  fakeDisk,
  resetFakeDisk,
} from '../../../adapters/file-system.spec.fixtures';
import { keepFile } from '../../../adapters/upload-journal';
import RecordRoute from '../../../app/(private)/collection/[recordId]';
import {
  collectionRecord,
  collectorId,
  renderMobile,
} from '../../../mobile.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import type { MediaDetail } from '@antica/contracts';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({
    recordId: '00000000-0000-4000-8000-000000000001',
  })),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

/** one asset of the record in each upload state */
const assets: MediaDetail[] = (
  ['ready', 'processing', 'uploaded', 'awaiting_upload', 'failed'] as const
).map((state, index) => ({
  ...media,
  asset: {
    ...media.asset,
    id: `00000000-0000-4000-8000-00000000030${index}`,
    state,
    originalFileName: `${state}.mp4`,
  },
}));

/**
 * opens the record whose media are in every upload state
 * @returns isolated mobile API and navigation boundaries
 */
async function openRecord(): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: assets.map(({ asset }) => asset.id) }
        : (assets.find(({ asset }) => path === `/v1/media/${asset.id}`) ?? {
            items: [],
            nextCursor: null,
          }),
  });
  await waitFor(() =>
    expect(screen.getByText('failed.mp4 · Not uploaded')).toBeTruthy(),
  );

  return view;
}

beforeEach(() => resetFakeDisk());

it('should count only the files storage verified, and never a failed one as uploaded', async () => {
  const view = await openRecord();

  expect(screen.getByTestId('record-media-count')).toHaveTextContent(
    '3 photos and videos uploaded',
  );
  // without a copy on this device there is nothing to send again
  expect(
    screen.queryByTestId(`record-media-${assets[4].asset.id}-retry`),
  ).toBeNull();
  view.client.clear();
});

it('should offer to send a failed file again while this device keeps its copy', async () => {
  fakeDisk().files.set('file:///cache/failed.mp4', 'bytes');
  await keepFile(
    {
      id: '00000000-0000-4000-8000-000000000310',
      uri: 'file:///cache/failed.mp4',
      name: 'failed.mp4',
      mimeType: 'video/mp4',
      kind: 'video',
      purpose: 'object',
      componentLabel: '',
      state: 'failed',
      assetId: null,
    },
    { userId: collectorId, recordId: collectionRecord.id, label: 'A-001' },
  );
  const view = await openRecord();

  await fireEvent.press(
    screen.getByTestId(`record-media-${assets[4].asset.id}-retry`),
  );

  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}&resume=1`,
  );
  view.client.clear();
});
