import { createHash } from 'node:crypto';

/**
 * serializes captured JSON with the framework's sorted-key hash convention
 * @param value JSON-compatible metadata
 * @returns deterministic JSON without changing array order or source strings
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

/**
 * hashes evidence text without altering its HTML or Unicode
 * @param text exact source or canonical JSON text
 * @returns SHA-256 hexadecimal digest
 */
export function hash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * derives a stable UUID before the framework binds it to the import owner
 * @param identity scoped evidence identity
 * @returns deterministic UUID
 */
export function stableId(identity: string): string {
  return hash(identity).replace(
    /^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,
    '$1-$2-4$3-8$4-$5',
  );
}
