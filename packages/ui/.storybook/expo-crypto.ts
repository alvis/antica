/** Browser digest names exposed through the Expo Crypto API shape. */
// eslint-disable-next-line @typescript-eslint/naming-convention -- mirrors Expo's public API
export const CryptoDigestAlgorithm = { SHA256: 'SHA-256' } as const;

/**
 * Creates a browser-native UUID for story commands.
 * @returns A random UUID.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Computes a browser-native digest for a story upload fixture.
 * @param algorithm Browser digest algorithm name.
 * @param data Bytes to digest.
 * @returns Browser-generated digest bytes.
 */
export async function digest(
  algorithm: string,
  data: BufferSource,
): Promise<ArrayBuffer> {
  return globalThis.crypto.subtle.digest(algorithm, data);
}
