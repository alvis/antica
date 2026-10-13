import { beforeEach, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  launchCameraAsync,
  launchImageLibraryAsync,
  requestCameraPermissionsAsync,
} from 'expo-image-picker';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('./media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
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
jest.mock('expo-image-picker', () => ({
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
  requestCameraPermissionsAsync: jest.fn(),
}));

beforeEach(() => {
  jest
    .mocked(requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: true } as Awaited<
      ReturnType<typeof requestCameraPermissionsAsync>
    >);
  jest
    .mocked(launchCameraAsync)
    .mockResolvedValue({ canceled: true, assets: null });
  jest
    .mocked(launchImageLibraryAsync)
    .mockResolvedValue({ canceled: true, assets: null });
});

/**
 * Opens a new record at its media capture step.
 * @returns The isolated mobile API and navigation boundaries.
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

it('should explain denied camera access without opening the picker', async () => {
  jest
    .mocked(requestCameraPermissionsAsync)
    .mockResolvedValue({ granted: false } as Awaited<
      ReturnType<typeof requestCameraPermissionsAsync>
    >);
  await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(launchCameraAsync).not.toHaveBeenCalled();
});

it('should append a supplementary photo while reviewing the original imported image', async () => {
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
        uri: 'file:///base.jpg',
        fileName: 'base.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  const view = await openCapture();
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByLabelText('front.jpg')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));
  await waitFor(() => expect(screen.getByLabelText('base.jpg')).toBeTruthy());
  expect(screen.getByLabelText('front.jpg')).toBeTruthy();
  view.client.clear();
});

it.each([
  { label: 'Photo', mediaTypes: 'images', extension: 'jpg' },
  { label: 'Video', mediaTypes: 'videos', extension: 'mp4' },
])(
  'should capture $label with a usable fallback filename',
  async ({ label, mediaTypes, extension }) => {
    jest.mocked(launchCameraAsync).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///capture', width: 640, height: 480 }],
    });
    await openCapture();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(launchCameraAsync).toHaveBeenCalledWith({ mediaTypes, quality: 1 });
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    expect(
      screen.getByText(new RegExp(`^antica-\\d+\\.${extension}$`)),
    ).toBeTruthy();
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
  expect(screen.queryByText(/^antica-/)).toBeNull();
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
