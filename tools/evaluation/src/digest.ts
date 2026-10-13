import { createHash } from 'node:crypto';

/**
 * hashes JSON with stable object-key order while preserving ordered arrays
 * @param value JSON-compatible snapshot content
 * @returns SHA-256 content identity
 */
export function digestSnapshot(value: unknown): string {
  return createHash('sha256')
    .update(
      JSON.stringify(value, (_key, child: unknown) => {
        if (
          child !== null &&
          typeof child === 'object' &&
          !Array.isArray(child)
        ) {
          return Object.fromEntries(
            Object.entries(child).toSorted(([left], [right]) =>
              left.localeCompare(right, 'en'),
            ),
          );
        }

        return child;
      }),
    )
    .digest('hex');
}
