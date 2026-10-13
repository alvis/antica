/**
 * Validates the public API origin configured for the mobile app.
 * @param value Configured Expo public URL.
 * @param development Whether the app runs in a development build.
 * @returns The canonical HTTP or HTTPS origin.
 */
export function readApiOrigin(
  value: string | undefined,
  development: boolean,
): string {
  if (!value) {
    throw new Error('EXPO_PUBLIC_API_URL is required.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'EXPO_PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
    );
  }

  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
    );
  }

  if (!development && url.protocol !== 'https:') {
    throw new Error('EXPO_PUBLIC_API_URL must use HTTPS outside development.');
  }

  return url.origin;
}
