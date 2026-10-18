import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { getItemAsync, setItemAsync } from 'expo-secure-store';

import { mediaDetailSchema } from '@antica/contracts';

import MediaRoute from '../../../app/(private)/media/[assetId]';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import {
  assetId,
  viewId,
  jobId,
  prepared,
  media,
  completedJob,
} from './media.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const privateOrigin = 'https://internal.example:8080';

beforeEach(() => {
  jest.mocked(getItemAsync).mockReset().mockResolvedValue(null);
  jest.mocked(setItemAsync).mockReset().mockResolvedValue(undefined);
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId });
});

it.each(['photo', 'cropped-photo', 'video'])(
  'should display saved %s evidence without changing its locator',
  async (kind) => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ assetId, anchorId: viewId });
    const isVideo = kind === 'video';
    const scope =
      kind === 'cropped-photo'
        ? {
            kind: 'region',
            region: { kind: 'rect', x: 0.1, y: 0.1, width: 0.5, height: 0.5 },
            cropDerivativeId: null,
          }
        : { kind: 'whole' };
    const saved = mediaDetailSchema.parse({
      ...media,
      asset: { ...media.asset, kind: isVideo ? 'video' : 'photo' },
      reads: kind === 'cropped-photo' ? [] : media.reads,
      anchors: [
        {
          id: viewId,
          kind: isVideo ? 'video_frame' : 'image',
          ...(isVideo ? { frame: prepared.frame } : {}),
          recordId: collectionRecord.id,
          componentIds: [],
          originalAssetId: assetId,
          canonicalViewId: prepared.view.id,
          scope,
          createdAt: collectionRecord.createdAt,
        },
      ],
    });
    const view = await renderMobile(<MediaRoute />, { get: async () => saved });
    await waitFor(() => expect(screen.getByText('Select region')).toBeTruthy());
    if (kind === 'photo') {
      expect(screen.getByLabelText('inspection.mp4')).toBeTruthy();
      expect(screen.getAllByText('Full image')).toHaveLength(2);
    } else if (kind === 'cropped-photo') {
      expect(screen.getByText(/^rect:/)).toHaveTextContent(/"width":0.5/);
      expect(screen.queryByLabelText('inspection.mp4')).toBeNull();
    } else {
      expect(screen.getByText('PTS 37 · 1480ms')).toBeTruthy();
    }
    expect(view.commands).not.toHaveBeenCalled();
  },
);

it.each(['', 'NaN', 'Infinity', '6'])(
  'should reject frame time %s before any preparation command',
  async (input) => {
    const view = await renderMobile(<MediaRoute />, { get: async () => media });
    await waitFor(() =>
      expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Frame time (seconds)'),
      input,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Prepare video frame' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /within the video duration/,
    );
    expect(view.commands).not.toHaveBeenCalled();
  },
);

it('should recover a failed media read and prepare a frame when duration is unknown', async () => {
  const readFailure = new Error(`Media unavailable at ${privateOrigin}`);
  const response = jest
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(readFailure)
    .mockResolvedValue({
      ...media,
      asset: { ...media.asset, durationMs: null },
    });
  const view = await renderMobile(<MediaRoute />, {
    get: response,
    post: async () => ({ id: jobId, kind: 'media' }),
  });
  await waitFor(() => {
    for (const alert of screen.getAllByRole('alert')) {
      expect(alert).toHaveTextContent(/\S/);
    }
  });
  expect(screen.queryAllByText(readFailure.message, { exact: false })).toEqual(
    [],
  );
  expect(screen.queryAllByText(privateOrigin, { exact: false })).toEqual([]);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    `/v1/media/${assetId}`,
  ]);
  expect([view.commands.mock.calls, view.patches.mock.calls]).toEqual([[], []]);
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
  );
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    `/v1/media/${assetId}`,
    `/v1/media/${assetId}`,
  ]);
  expect(screen.queryByRole('alert')).toBeNull();
  view.reads.mockResolvedValueOnce(completedJob);
  await fireEvent.changeText(
    screen.getByLabelText('Frame time (seconds)'),
    '6',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Prepared video frame')).toBeTruthy(),
  );
  expect(view.commands.mock.calls[0]?.[2]?.body).toMatchObject({
    requestedTimeMs: 6000,
  });
});

it.each(['prepare', 'save'])(
  'should reject a mismatched evidence response during frame %s',
  async (phase) => {
    if (phase === 'save') {
      jest
        .mocked(getItemAsync)
        .mockImplementation(async (key) =>
          key.includes('frameJob.') ? jobId : null,
        );
    }
    await renderMobile(<MediaRoute />, {
      get: async (path) =>
        path.startsWith('/v1/media/') ? media : completedJob,
      post: async () =>
        phase === 'prepare'
          ? { kind: 'image', id: viewId }
          : { kind: 'media', id: jobId },
    });
    if (phase === 'prepare') {
      await waitFor(() =>
        expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
      );
      await fireEvent.changeText(
        screen.getByLabelText('Frame time (seconds)'),
        '1',
      );
      await fireEvent.press(
        screen.getByRole('button', { name: 'Prepare video frame' }),
      );
    } else {
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'Use frame as evidence' }),
        ).toBeTruthy(),
      );
      await fireEvent.press(
        screen.getByRole('button', { name: 'Use frame as evidence' }),
      );
    }
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Something went wrong.',
      ),
    );
    expect(screen.queryByRole('button', { name: 'Saved' })).toBeNull();
  },
);

it('should resume polling a queued saved frame job until its preview is available', async () => {
  jest
    .mocked(getItemAsync)
    .mockImplementation(async (key) =>
      key.includes('frameJob.') ? jobId : null,
    );
  const jobs = jest
    .fn<() => Promise<unknown>>()
    .mockResolvedValueOnce({
      ...completedJob,
      state: { kind: 'queued' },
      result: null,
    })
    .mockResolvedValue(completedJob);
  await renderMobile(<MediaRoute />, {
    get: async (path) => (path.startsWith('/v1/media/') ? media : jobs()),
  });
  await waitFor(() => expect(screen.getByText('Queued')).toBeTruthy());
  await waitFor(
    () => expect(screen.getByLabelText('Prepared video frame')).toBeTruthy(),
    { timeout: 10000 },
  );
  expect(jobs).toHaveBeenCalledTimes(2);
});
