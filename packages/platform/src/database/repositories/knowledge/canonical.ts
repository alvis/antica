import { createHash } from 'node:crypto';

/**
 * serializes JSON with ordered object keys while preserving array order
 * @param value validated JSON-compatible content
 * @returns deterministic JSON bytes for snapshots and revision hashes
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
 * hashes the complete canonical JSON value
 * @param value validated JSON-compatible content
 * @returns SHA-256 hexadecimal digest
 */
export function canonicalHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

/**
 * derives a revision-local UUID without relying on projection write order
 * @param identity stable aggregate and projection identity
 * @returns deterministic UUID for rebuilding normalized rows
 */
export function projectionId(identity: string): string {
  const digest = canonicalHash(identity);

  return digest.replace(
    /^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,
    '$1-$2-4$3-a$4-$5',
  );
}
