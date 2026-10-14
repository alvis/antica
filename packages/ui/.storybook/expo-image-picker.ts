const canceledSelection = { canceled: true, assets: null } as const;

/**
 * reports unavailable native camera permission in the browser fixture
 * @returns a denied camera permission result
 */
export async function requestCameraPermissionsAsync(): Promise<{
  granted: false;
}> {
  return { granted: false };
}

/**
 * leaves camera capture canceled when Storybook runs in a browser
 * @returns a canceled camera selection
 */
export async function launchCameraAsync(): Promise<typeof canceledSelection> {
  return canceledSelection;
}

/**
 * leaves native-library selection canceled in the browser fixture
 * @returns a canceled image-library selection
 */
export async function launchImageLibraryAsync(): Promise<
  typeof canceledSelection
> {
  return canceledSelection;
}
