/** camera access a browser story reports: refused, so the camera falls back to import */
const deniedCamera = {
  granted: false,
  canAskAgain: false,
  status: 'denied',
  expires: 'never',
} as const;

/**
 * answers a camera-access request in the browser fixture
 * @returns the refused camera access
 */
async function requestPermission(): Promise<typeof deniedCamera> {
  return deniedCamera;
}

/**
 * reports refused camera access, since stories run without a native camera
 * @returns the access, a request action, and a read action
 */
export function useCameraPermissions(): [
  typeof deniedCamera,
  typeof requestPermission,
  typeof requestPermission,
] {
  return [deniedCamera, requestPermission, requestPermission];
}

/**
 * renders no preview, since stories run without a native camera
 * @returns nothing
 */
export function CameraView(): null {
  return null;
}
