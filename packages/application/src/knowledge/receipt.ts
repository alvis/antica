import { createHash } from 'node:crypto';

/**
 * computes a stable fingerprint for a validated command
 * @param value validated command body and path identity
 * @returns sha256 fingerprint independent of object key order
 */
export function requestFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortValue(value)))
    .digest('hex');
}

/**
 * sorts object keys recursively so equivalent JSON objects hash identically
 * @param value nested JSON-compatible value to normalize
 * @returns value with deterministic object key order
 */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }

  return value;
}
