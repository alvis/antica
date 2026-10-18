import { expect, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { forwardRef, useImperativeHandle } from 'react';
import { View } from 'react-native';

import type {
  CameraCapturedPicture,
  CameraViewProps,
  PermissionResponse,
} from 'expo-camera';

/** camera access the mocked permission hook reports */
export const grantedCamera: PermissionResponse = {
  granted: true,
  canAskAgain: true,
  status: 'granted' as PermissionResponse['status'],
  expires: 'never',
};

/** camera access before the collector answered the system dialog */
export const undecidedCamera: PermissionResponse = {
  granted: false,
  canAskAgain: true,
  status: 'undetermined' as PermissionResponse['status'],
  expires: 'never',
};

/** camera access the collector refused */
export const deniedCamera: PermissionResponse = {
  granted: false,
  canAskAgain: false,
  status: 'denied' as PermissionResponse['status'],
  expires: 'never',
};

/** controllable state of the mocked expo-camera module */
export const camera = {
  /** what useCameraPermissions reports; null while it is still reading */
  permission: grantedCamera as PermissionResponse | null,
  /** what the system dialog answers when access is requested */
  answer: deniedCamera,
  requestPermission: jest.fn(async (): Promise<PermissionResponse> => {
    camera.permission = camera.answer;

    return camera.answer;
  }),
  takePictureAsync: jest.fn(async (): Promise<CameraCapturedPicture> => ({
    uri: `file:///shot-${camera.takePictureAsync.mock.calls.length}.jpg`,
    width: 640,
    height: 480,
    format: 'jpg',
  })),
  /** props of the most recently rendered preview */
  props: null as CameraViewProps | null,
};

/** replacement for the expo-camera module backed by {@link camera} */
export const expoCameraMock = {
  useCameraPermissions: () => [
    camera.permission,
    camera.requestPermission,
    camera.requestPermission,
  ],
  CameraView: forwardRef<unknown, CameraViewProps>(
    function MockCameraView(props, ref) {
      useImperativeHandle(ref, () => ({
        takePictureAsync: camera.takePictureAsync,
      }));
      camera.props = props;

      return <View testID={props.testID} />;
    },
  ),
};

/** restores the mocked camera to granted access with working shots */
export function resetCamera(): void {
  camera.permission = grantedCamera;
  camera.answer = deniedCamera;
  camera.props = null;
  camera.requestPermission.mockClear();
  camera.takePictureAsync.mockClear();
}

/**
 * takes photos with the in-app camera, choosing a shot type before each
 * @param shotTypes English names of the shot-type chips to choose, one per photo
 * @returns resolves once every photo joined the draft
 */
export async function shoot(shotTypes: readonly string[]): Promise<void> {
  for (const [index, shotType] of shotTypes.entries()) {
    await fireEvent.press(screen.getByRole('radio', { name: shotType }));
    await fireEvent.press(screen.getByRole('button', { name: 'Take photo' }));
    await waitFor(() =>
      expect(screen.getByText(`Photo ${index + 1} added`)).toBeTruthy(),
    );
  }
}
