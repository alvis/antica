/** browser digest names exposed through the Expo Crypto API shape */
// eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors Expo's public API
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;

/**
 * creates a browser-native UUID for story commands
 * @returns a random UUID
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * computes a browser-native digest for a story upload fixture
 * @param algorithm browser digest algorithm name
 * @param data bytes to digest
 * @returns browser-generated digest bytes
 */
export async function digest(
  algorithm: string,
  data: BufferSource,
): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.digest(algorithm, data);
}
