import { createHash } from 'node:crypto';

import { OriginalVerificationError } from '@antica/application/ports';

import type { OriginalObject } from './media-store.js';

/**
 * detects the supported media type from stored byte signatures
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const header = Buffer.from(bytes.subarray(0, 16));
  if (header.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return 'image/jpeg';
  }
  if (
    header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (header.toString('ascii', 0, 4) === '%PDF') {
    return 'application/pdf';
  }
  if (
    header.toString('ascii', 0, 4) === 'RIFF' &&
    header.toString('ascii', 8, 12) === 'WAVE'
  ) {
    return 'audio/wav';
  }
  if (
    header.toString('ascii', 0, 3) === 'ID3' ||
    (header[0] === 0xff && (header[1]! & 0xe0) === 0xe0)
  ) {
    return 'audio/mpeg';
  }
  if (header.toString('ascii', 4, 8) === 'ftyp') {
    const brand = header.toString('ascii', 8, 12);
    if (brand.startsWith('hei') || brand.startsWith('mif')) {
      return 'image/heic';
    }
    if (brand === 'qt  ') {
      return 'video/quicktime';
    }
    if (brand === 'M4A ') {
      return 'audio/mp4';
    }
    return 'video/mp4';
  }
  return null;
}

/**
 * verifies stored bytes against the declared length, checksum and actual file signature
 */
export function verifyBytes(
  bytes: Uint8Array,
  expected: Pick<OriginalObject, 'byteLength' | 'sha256' | 'mimeType'>,
): void {
  if (bytes.byteLength !== expected.byteLength) {
    throw new OriginalVerificationError({
      reason: 'mismatch',
      message: 'Stored media size mismatch',
    });
  }
  if (
    createHash('sha256').update(bytes).digest('hex') !==
    expected.sha256.toLowerCase()
  ) {
    throw new OriginalVerificationError({
      reason: 'mismatch',
      message: 'Stored media checksum mismatch',
    });
  }
  const detected = sniffMime(bytes);
  if (detected !== expected.mimeType) {
    throw new OriginalVerificationError({
      reason: 'mismatch',
      message: 'Stored media MIME mismatch',
    });
  }
}
