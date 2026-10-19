import { createHash } from 'node:crypto';

/**
 * Serializes JSON with sorted object keys, preserved Unicode and ordered arrays.
 * @param value captured data to serialize
 * @returns canonical JSON without a trailing newline
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value) as string | undefined;
  if (serialized === undefined) {
    throw new Error('Expected a JSON value');
  }

  return serialized;
}

/**
 * Hashes exact UTF-8 text with SHA-256.
 * @param text text to hash
 * @returns lowercase hexadecimal digest
 */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
