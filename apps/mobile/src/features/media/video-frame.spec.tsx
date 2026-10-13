import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { getItemAsync, setItemAsync } from 'expo-secure-store';

import MediaRoute from '../../app/(private)/media/[assetId]';
import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import {
  assetId,
  viewId,
  jobId,
  prepared,
  media,
  completedJob,
} from './media.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
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

beforeEach(() => {
  jest.mocked(getItemAsync).mockReset().mockResolvedValue(null);
  jest.mocked(setItemAsync).mockReset().mockResolvedValue(undefined);
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId });
});

it('should create an anchor from the returned frame locator after previewing the derivative', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId });
  const view = await renderMobile(<MediaRoute />, {
    get: async (path) => (path.startsWith('/v1/media/') ? media : completedJob),
    post: async () => ({ id: jobId, kind: 'media' }),
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Frame time (seconds)'),
    '1.5',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Prepared video frame')).toBeTruthy(),
  );
  view.commands.mockResolvedValueOnce({ kind: 'video_frame', id: viewId });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use frame as evidence' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled(),
  );
  expect(view.commands.mock.calls.map(([, , options]) => options.body)).toEqual(
    [
      expect.objectContaining({
        mode: 'prepare_frame',
        originalAssetId: assetId,
        requestedTimeMs: 1500,
      }),
      expect.objectContaining({
        mode: 'create',
        evidence: {
          kind: 'video_frame',
          recordId: collectionRecord.id,
          componentIds: [],
          originalAssetId: assetId,
          canonicalViewId: viewId,
          scope: { kind: 'whole' },
          frame: prepared.frame,
        },
      }),
    ],
  );
});

it('should reject invalid time, retry preparation safely, and withhold an unreadable frame', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId });
  const view = await renderMobile(<MediaRoute />, {
    get: async (path) =>
      path.startsWith('/v1/media/') ? { ...media, reads: [] } : completedJob,
    post: async () => ({ id: jobId, kind: 'media' }),
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Frame time (seconds)'),
    '-1',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    /within the video duration/,
  );
  expect(view.commands).not.toHaveBeenCalled();
  view.commands.mockRejectedValueOnce(new Error('Connection lost'));
  await fireEvent.changeText(
    screen.getByLabelText('Frame time (seconds)'),
    '1.5',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() =>
    expect(screen.getByText(/Actual frame time/)).toBeTruthy(),
  );
  expect(
    screen.queryByRole('button', { name: 'Use frame as evidence' }),
  ).toBeNull();
  expect(view.commands.mock.calls[1]?.[2]).toEqual(
    view.commands.mock.calls[0]?.[2],
  );
});

it('should start a new preparation identity after a failed frame job', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId });
  const failedJob = {
    ...completedJob,
    state: { kind: 'failed', error: { message: 'Frame extraction failed' } },
    result: null,
  };
  const view = await renderMobile(<MediaRoute />, {
    get: async (path) => (path.startsWith('/v1/media/') ? media : failedJob),
    post: async () => ({ id: jobId, kind: 'media' }),
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Frame time (seconds)')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Frame time (seconds)'),
    '1.5',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Frame extraction failed',
    ),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(2));
  expect(view.commands.mock.calls[1]?.[2]?.idempotencyKey).not.toBe(
    view.commands.mock.calls[0]?.[2]?.idempotencyKey,
  );
});

it('should restore a prepared frame and preserve anchor identity when saving fails', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ assetId, checkId: viewId });
  jest
    .mocked(getItemAsync)
    .mockImplementation(async (key) =>
      key.includes('frameJob.') ? jobId : null,
    );
  const view = await renderMobile(<MediaRoute />, {
    get: async (path) => (path.startsWith('/v1/media/') ? media : completedJob),
    post: async () => ({ id: viewId, kind: 'video_frame' }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Use frame as evidence' }),
    ).toBeTruthy(),
  );
  view.commands.mockRejectedValueOnce(new Error('Anchor connection lost'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use frame as evidence' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Anchor connection lost',
    ),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Use frame as evidence' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled(),
  );
  expect(view.commands.mock.calls[1]?.[2]).toEqual(
    view.commands.mock.calls[0]?.[2],
  );
  expect(view.commands.mock.calls[1]?.[2]?.body).toMatchObject({
    checkId: viewId,
  });
});

it.each(['restore', 'persist'])(
  'should report secure-storage failure during frame job %s',
  async (phase) => {
    if (phase === 'restore') {
      jest.mocked(getItemAsync).mockImplementation(async (key) => {
        if (key.includes('frameJob.')) {
          throw new Error('Frame state unavailable');
        }

        return null;
      });
    } else {
      jest
        .mocked(setItemAsync)
        .mockRejectedValueOnce(new Error('Frame state unavailable'));
    }
    await renderMobile(<MediaRoute />, {
      get: async (path) =>
        path.startsWith('/v1/media/') ? media : completedJob,
      post: async () => ({ id: jobId, kind: 'media' }),
    });
    if (phase === 'persist') {
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
    }
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Frame state unavailable',
      ),
    );
  },
);
