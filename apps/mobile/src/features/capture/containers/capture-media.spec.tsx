import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: jest.fn(async () => ({
    uri: 'file:///still.jpg',
    width: 64,
    height: 48,
  })),
}));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock(
  'expo-image-picker',
  () =>
    ({
      launchCameraAsync: jest.fn<typeof launchCameraAsync>(async () => ({
        canceled: true,
        assets: null,
      })),
      launchImageLibraryAsync: jest.fn<typeof launchImageLibraryAsync>(
        async () => ({ canceled: true, assets: null }),
      ),
      requestCameraPermissionsAsync: jest.fn<
        typeof requestCameraPermissionsAsync
      >(
        async () =>
          ({ granted: true }) as Awaited<
            ReturnType<typeof requestCameraPermissionsAsync>
          >,
      ),
    }) satisfies Partial<typeof import('expo-image-picker')>,
);

/**
 * opens a new record at its media capture step
 * @returns the isolated mobile API and navigation boundaries
 */
async function openCapture(): Promise<
  Awaited<ReturnType<typeof renderMobile>>
> {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );

  return view;
}

it('should explain denied camera access without opening the video recorder', async () => {
  jest
    .mocked(requestCameraPermissionsAsync)
    .mockResolvedValueOnce({ granted: false } as Awaited<
      ReturnType<typeof requestCameraPermissionsAsync>
    >);
  await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Video' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(launchCameraAsync).not.toHaveBeenCalled();
});

it('should open the in-app camera for photos instead of the system camera', async () => {
  const view = await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));

  expect(screen.getByTestId('capture-camera')).toBeTruthy();
  expect(launchCameraAsync).not.toHaveBeenCalled();
  view.client.clear();
});

it('should append a recorded video while reviewing the original imported image', async () => {
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: 'file:///front.jpg',
        fileName: 'front.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  jest.mocked(launchCameraAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: 'file:///turn.mov',
        fileName: 'turn.mov',
        mimeType: 'video/quicktime',
        width: 640,
        height: 480,
      },
    ],
  });
  const view = await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByTestId('capture-grid-still-1').props.source).toEqual({
    uri: 'file:///front.jpg',
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Add video' }));
  await waitFor(() => expect(screen.getByLabelText('Video 2')).toBeTruthy());
  expect(launchCameraAsync).toHaveBeenCalledWith({
    mediaTypes: 'videos',
    quality: 1,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('front.jpg: On device')).toBeTruthy();
  expect(screen.getByText('turn.mov: On device')).toBeTruthy();
  view.client.clear();
});

it.each([
  { label: 'Video', camera: true, extension: 'mp4' },
  { label: 'Import file', camera: false, extension: 'jpg' },
])(
  'should add $label with a usable fallback filename',
  async ({ label, camera, extension }) => {
    jest
      .mocked(camera ? launchCameraAsync : launchImageLibraryAsync)
      .mockResolvedValueOnce({
        canceled: false,
        assets: [{ uri: 'file:///capture', width: 640, height: 480 }],
      });
    const view = await openCapture();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(
        camera ? launchCameraAsync : launchImageLibraryAsync,
      ).toHaveBeenCalled(),
    );
    for (const name of ['Continue', 'Next', 'Continue', 'Continue']) {
      await fireEvent.press(screen.getByRole('button', { name }));
    }
    expect(
      screen.getByText(new RegExp(`^antica-\\d+\\.${extension}: On device$`)),
    ).toBeTruthy();
    view.client.clear();
  },
);

it('should leave the media list empty after canceling import and surface picker errors', async () => {
  await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  expect(screen.queryByRole('alert')).toBeNull();
  jest
    .mocked(launchImageLibraryAsync)
    .mockRejectedValueOnce(new Error('Picker unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Picker unavailable'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('0 selected')).toBeTruthy();
});

it('should show a failed draft creation and allow retrying the chosen record kind', async () => {
  const view = await renderMobile(<CaptureContainer />, {
    get: async () => [],
  });
  view.commands
    .mockRejectedValueOnce(new Error('Draft service unavailable'))
    .mockResolvedValueOnce(collectionRecord);
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Draft service unavailable',
    ),
  );
  expect(screen.getByRole('button', { name: 'Single item' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(view.commands.mock.calls.map(([, , options]) => options.body)).toEqual(
    [{ unitKind: 'single' }, { unitKind: 'single' }],
  );
  view.client.clear();
});
