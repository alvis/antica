const cancelledSelection = { canceled: true, assets: null } as const;

/**
 * Reports unavailable native camera permission in the browser fixture.
 * @returns A denied camera permission result.
 */
export async function requestCameraPermissionsAsync(): Promise<{
  granted: false;
}> {
  return { granted: false };
}

/**
 * Leaves camera capture cancelled when Storybook runs in a browser.
 * @returns A cancelled camera selection.
 */
export async function launchCameraAsync(): Promise<typeof cancelledSelection> {
  return cancelledSelection;
}

/**
 * Leaves native-library selection cancelled in the browser fixture.
 * @returns A cancelled image-library selection.
 */
export async function launchImageLibraryAsync(): Promise<
  typeof cancelledSelection
> {
  return cancelledSelection;
}
