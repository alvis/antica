import { createHash } from 'node:crypto';

const uuidBytes = 16;
const uuidVersionOffset = 6;
const uuidVariantOffset = 8;
const versionMask = 15;
const uuidV8Bits = 128;
const variantMask = 63;
const rfcVariantBits = 128;

/**
 * derives an owner-scoped UUIDv8 from a domain-separated SHA-256 digest
 * @param ownerId collector namespace
 * @param identity stable content or immutable snapshot identity
 * @returns deterministic UUIDv8
 */
export function corpusId(ownerId: string, identity: string): string {
  const bytes = createHash('sha256')
    .update('antica:corpus:v1:')
    .update(JSON.stringify([ownerId, identity]))
    .digest()
    .subarray(0, uuidBytes);
  bytes[uuidVersionOffset] =
    (bytes[uuidVersionOffset]! & versionMask) | uuidV8Bits;
  bytes[uuidVariantOffset] =
    (bytes[uuidVariantOffset]! & variantMask) | rfcVariantBits;
  const hex = bytes.toString('hex');

  return hex.replace(
    /^(........)(....)(....)(....)(............)$/,
    '$1-$2-$3-$4-$5',
  );
}
