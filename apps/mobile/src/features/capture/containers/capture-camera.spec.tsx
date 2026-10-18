import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { launchImageLibraryAsync } from 'expo-image-picker';
import { Linking } from 'react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import {
  camera,
  deniedCamera,
  grantedCamera,
  resetCamera,
  shoot,
  undecidedCamera,
} from './capture-camera.spec.fixtures';
import { CaptureContainer } from './CaptureContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
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
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock(
  'expo-camera',
  () =>
    jest.requireActual<typeof import('./capture-camera.spec.fixtures')>(
      './capture-camera.spec.fixtures',
    ).expoCameraMock,
);
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///base.jpg', fileName: 'base.jpg', mimeType: 'image/jpeg' },
    ],
  })),
}));

const namedRecord = {
  ...collectionRecord,
  name: 'Celadon vases',
  code: 'AC-0001',
};

/**
 * opens a new record's in-app camera from the media step
 * @param kind record unit kind chosen first
 * @returns the isolated mobile API and navigation boundaries
 */
async function openCamera(
  kind: 'Single item' | 'Set' = 'Set',
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => (path === '/v1/locations' ? [] : namedRecord),
    post: async () => namedRecord,
  });
  await fireEvent.press(screen.getByRole('button', { name: kind }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Photo' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Photo' }));

  return view;
}

beforeEach(resetCamera);

describe('in-app camera', () => {
  it('should add every shot to the draft while the camera stays open', async () => {
    const view = await openCamera();

    expect(
      screen.getByRole('header', { name: 'Photograph item' }),
    ).toBeTruthy();
    expect(screen.getByText('Celadon vases · AC-0001')).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Review 0 photos taken' }),
    ).toBeDisabled();

    const shots = ['Complete set', 'Base', 'Mark'];
    await shoot(shots);

    expect(camera.takePictureAsync).toHaveBeenCalledTimes(shots.length);
    expect(screen.getByTestId('capture-camera')).toBeTruthy();
    expect(view.router.replace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Review 3 photos taken' }),
    ).toBeEnabled();
    view.client.clear();
  });

  it('should keep the chosen shot type as the selected chip', async () => {
    const view = await openCamera();

    expect(screen.getByRole('radio', { name: 'Complete set' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Detail' }));

    expect(screen.getByRole('radio', { name: 'Detail' })).toBeChecked();
    expect(
      screen.getByRole('radio', { name: 'Complete set' }),
    ).not.toBeChecked();
    view.client.clear();
  });

  it('should review the shots in the grid from the last-shot thumbnail', async () => {
    const view = await openCamera();
    await shoot(['Complete set', 'Base']);

    await fireEvent.press(
      screen.getByRole('button', { name: 'Review 2 photos taken' }),
    );

    expect(screen.queryByTestId('capture-camera')).toBeNull();
    expect(
      screen.getByRole('header', { name: 'Organize photos' }),
    ).toBeTruthy();
    expect(screen.getByText('2 selected')).toBeTruthy();
    expect(screen.getByTestId('capture-grid-tile-2')).toBeTruthy();
    view.client.clear();
  });
});

describe('camera controls', () => {
  it('should switch cameras and toggle the flash on the preview', async () => {
    const view = await openCamera();

    expect(camera.props).toMatchObject({ facing: 'back', flash: 'off' });
    await fireEvent.press(screen.getByRole('switch', { name: 'Flash' }));
    await fireEvent.press(
      screen.getByRole('button', { name: 'Switch camera' }),
    );

    expect(camera.props).toMatchObject({ facing: 'front', flash: 'on' });
    expect(screen.getByRole('switch', { name: 'Flash' })).toBeChecked();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Switch camera' }),
    );

    expect(camera.props).toMatchObject({ facing: 'back' });
    view.client.clear();
  });

  it('should report a failed shot and add nothing', async () => {
    camera.takePictureAsync.mockRejectedValueOnce(new Error('Camera busy'));
    const view = await openCamera();

    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));

    // the native reason is not shown to collectors
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The photo could not be taken. Try again.',
      ),
    );
    expect(screen.queryByText(/Camera busy/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Close camera' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('0 selected')).toBeTruthy();
    view.client.clear();
  });

  it('should return to the step it was opened from when closed', async () => {
    const view = await openCamera();
    await shoot(['Complete set']);

    await fireEvent.press(screen.getByRole('button', { name: 'Close camera' }));

    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add photo' }));

    expect(screen.getByTestId('capture-camera')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Close camera' }));

    expect(screen.getByText('1 selected')).toBeTruthy();
    view.client.clear();
  });
});

describe('camera access', () => {
  it('should wait with the shutter disabled while access is being read', async () => {
    camera.permission = null;
    const view = await openCamera();

    expect(screen.getByTestId('capture-camera-waiting')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    expect(camera.requestPermission).not.toHaveBeenCalled();
    view.client.clear();
  });

  it('should ask once and start the preview when access is granted', async () => {
    camera.permission = undecidedCamera;
    camera.answer = grantedCamera;
    const view = await openCamera();

    await waitFor(() =>
      expect(screen.getByTestId('capture-camera-preview')).toBeTruthy(),
    );
    expect(camera.requestPermission).toHaveBeenCalledTimes(1);
    view.client.clear();
  });
});

describe('camera fallback', () => {
  it('should fall back to library import with a settings link when access is denied', async () => {
    const openSettings = jest
      .spyOn(Linking, 'openSettings')
      .mockResolvedValue(undefined);
    camera.permission = undecidedCamera;
    const view = await openCamera();

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Camera access was denied. Allow it in system settings, or import photos instead.',
      ),
    );
    expect(camera.requestPermission).toHaveBeenCalledTimes(1);
    await fireEvent.press(
      screen.getByRole('button', { name: 'Open system settings' }),
    );

    expect(openSettings).toHaveBeenCalled();
    // the screen behind the camera modal offers its own Import file
    await fireEvent.press(screen.getByTestId('capture-camera-import'));

    expect(launchImageLibraryAsync).toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByTestId('capture-camera-denied')).toBeNull(),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

    expect(screen.getByText('1 selected')).toBeTruthy();
    view.client.clear();
  });

  it('should treat a refusal that cannot be asked again as denied without asking', async () => {
    camera.permission = deniedCamera;
    const view = await openCamera();

    expect(screen.getByTestId('capture-camera-denied')).toBeTruthy();
    expect(camera.requestPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Close camera' }));

    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy();
    view.client.clear();
  });

  it('should offer import without settings when the camera cannot start', async () => {
    const view = await openCamera();

    await act(async () =>
      camera.props?.onMountError?.({ message: 'No camera' }),
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'The camera is not available right now. You can import photos instead.',
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'Open system settings' }),
    ).toBeNull();
    view.client.clear();
  });
});
