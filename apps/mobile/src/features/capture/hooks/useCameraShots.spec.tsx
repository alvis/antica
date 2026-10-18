import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import {
  camera,
  resetCamera,
} from '../containers/capture-camera.spec.fixtures';

import { useCameraShots } from './useCameraShots';

import type { CameraView } from 'expo-camera';

jest.mock(
  'expo-camera',
  () =>
    jest.requireActual<
      typeof import('../containers/capture-camera.spec.fixtures')
    >('../containers/capture-camera.spec.fixtures').expoCameraMock,
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

beforeEach(resetCamera);

describe('fn:useCameraShots', () => {
  it('should take one photo when the shutter is pressed twice before the first one exists', async () => {
    const onShot = jest.fn();
    const view = await renderHook(() => useCameraShots(onShot));
    view.result.current.camera.current = {
      takePictureAsync: camera.takePictureAsync,
    } as unknown as CameraView;

    await act(async () => {
      await Promise.all([
        view.result.current.shoot(),
        view.result.current.shoot(),
      ]);
    });

    expect(camera.takePictureAsync).toHaveBeenCalledTimes(1);
    expect(onShot).toHaveBeenCalledTimes(1);
    expect(view.result.current.shotCount).toBe(1);
    // the guard is released, so the next press takes the next photo
    await act(async () => view.result.current.shoot());

    expect(view.result.current.shotCount).toBe(2);
  });

  it('should take nothing while the preview has no native handle', async () => {
    const onShot = jest.fn();
    const view = await renderHook(() => useCameraShots(onShot));

    await act(async () => view.result.current.shoot());

    expect(camera.takePictureAsync).not.toHaveBeenCalled();
    expect(onShot).not.toHaveBeenCalled();
    expect(view.result.current.failed).toBe(false);
  });
});
