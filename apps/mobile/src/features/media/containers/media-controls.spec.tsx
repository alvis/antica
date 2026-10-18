import { beforeEach, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getItemAsync } from 'expo-secure-store';

import MediaRoute from '../../../app/(private)/media/[assetId]';
import { renderMobile } from '../../../mobile.spec.fixtures';

import { completedJob, jobId, media, viewId } from './media.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({
    assetId: '00000000-0000-4000-8000-000000000020',
  }),
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
});

it.each(['photo', 'source-video'])(
  'should withhold frame controls for %s media',
  async (kind) => {
    const asset =
      kind === 'photo'
        ? { ...media.asset, kind: 'photo' }
        : {
            ...media.asset,
            owner: { kind: 'source_version', sourceVersionId: viewId },
          };
    await renderMobile(<MediaRoute />, {
      get: async () => ({ ...media, asset }),
    });
    await waitFor(() =>
      expect(screen.getByRole('header')).toHaveTextContent('inspection.mp4'),
    );
    expect(
      screen.queryByRole('button', { name: 'Prepare video frame' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Use frame as evidence' }),
    ).toBeNull();
  },
);

it('should disable preparation until the video is ready', async () => {
  const view = await renderMobile(<MediaRoute />, {
    get: async () => ({
      ...media,
      asset: { ...media.asset, state: 'processing' },
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Prepare video frame' }),
    ).toBeDisabled(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Prepare video frame' }),
  );
  expect(view.commands).not.toHaveBeenCalled();
});

it.each(['prepare', 'save'])(
  'should disable frame %s while its command is pending',
  async (phase) => {
    if (phase === 'save') {
      jest
        .mocked(getItemAsync)
        .mockImplementation(async (key) =>
          key.includes('frameJob.') ? jobId : null,
        );
    }
    const view = await renderMobile(<MediaRoute />, {
      get: async (path) =>
        path.startsWith('/v1/media/') ? media : completedJob,
    });
    const label =
      phase === 'save' ? 'Use frame as evidence' : 'Prepare video frame';
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toBeEnabled(),
    );
    if (phase === 'prepare') {
      await fireEvent.changeText(
        screen.getByLabelText('Frame time (seconds)'),
        '1',
      );
    }
    const pending = Promise.withResolvers<unknown>();
    view.commands.mockReturnValueOnce(pending.promise);
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(view.commands).toHaveBeenCalledTimes(1);
    await act(async () =>
      pending.resolve(
        phase === 'save'
          ? { id: viewId, kind: 'video_frame' }
          : { id: jobId, kind: 'media' },
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', {
          name: phase === 'save' ? 'Saved' : label,
        }),
      ).toBeTruthy(),
    );
  },
);
