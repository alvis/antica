import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { sniffMime, verifyBytes } from './verify.js';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
    'base64',
  ),
);
const declaration = {
  byteLength: png.byteLength,
  sha256: createHash('sha256').update(png).digest('hex'),
  mimeType: 'image/png',
};

describe('fn:sniffMime', () => {
  it.each([
    [Uint8Array.from([0xff, 0xd8, 0xff]), 'image/jpeg'],
    [Buffer.from('RIFF0000WEBP'), 'image/webp'],
    [Buffer.from('%PDF-1.4'), 'application/pdf'],
    [Buffer.from('RIFF0000WAVE'), 'audio/wav'],
    [Buffer.from('ID3'), 'audio/mpeg'],
    [Uint8Array.from([0xff, 0xe3]), 'audio/mpeg'],
    [Buffer.from('0000ftypheic'), 'image/heic'],
    [Buffer.from('0000ftypmif1'), 'image/heic'],
    [Buffer.from('0000ftypqt  '), 'video/quicktime'],
    [Buffer.from('0000ftypM4A '), 'audio/mp4'],
    [Buffer.from('0000ftypisom'), 'video/mp4'],
    [Buffer.from('not-media'), null],
    [Uint8Array.from([0xff]), null],
  ])(
    'should identify supported media signatures or reject unknown bytes: %j',
    (bytes, mimeType) => {
      expect(sniffMime(bytes)).toBe(mimeType);
    },
  );
});

describe('fn:verifyBytes', () => {
  it('should accept an original whose bytes, length, checksum, and media type match', () => {
    expect(() => verifyBytes(png, declaration)).not.toThrow();
  });

  it('should reject equal-sized corruption even when the PNG signature is intact', () => {
    const corrupted = Uint8Array.from(png);
    corrupted[corrupted.length - 1] = 0;

    expect(() => verifyBytes(corrupted, declaration)).toThrow();
  });

  it('should reject a PDF relabeled as an image even with its real checksum', () => {
    const pdf = new TextEncoder().encode('%PDF-1.4\nnot an image');

    expect(() =>
      verifyBytes(pdf, {
        byteLength: pdf.length,
        sha256: createHash('sha256').update(pdf).digest('hex'),
        mimeType: 'image/png',
      }),
    ).toThrow();
  });

  it('should reject an incomplete upload before considering its checksum valid', () => {
    const truncated = png.subarray(0, 8);
    expect(() =>
      verifyBytes(truncated, {
        ...declaration,
        sha256: createHash('sha256').update(truncated).digest('hex'),
      }),
    ).toThrow();
  });
});
