import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createLocalMediaStore } from '@antica/platform';

import { verifyThumbnailPage } from './thumbnails.js';

const secret = 'synthetic-test-signing-secret-with-32-characters';
const origin = 'https://benchmark.invalid';
const now = 1_800_000_000_000;
const recordId = '10000000-0000-4000-8000-000000000001';
const expectedKey = 'synthetic-benchmark/thumbnails/1.jpg';

/** @param overrides signed token fields changed by an adversarial fixture */
function signedUrl(overrides: Record<string, unknown> = {}): string {
  const body = Buffer.from(
    JSON.stringify({
      mode: 'read',
      key: expectedKey,
      expiresAt: now + 300_000,
      ...overrides,
    }),
  ).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(body)
    .digest('base64url');

  return `${origin}/v1/storage/reads/${body}.${signature}`;
}

/** @param coverThumbnail candidate cover URL */
function verify(coverThumbnail: string | null) {
  return verifyThumbnailPage(
    { items: [{ id: recordId, coverThumbnail }] },
    secret,
    origin,
  );
}

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.spyOn(Date, 'now').mockReturnValue(now);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('fn:verifyThumbnailPage', () => {
  it('should verify the real local signer and deliberate nullable covers', async () => {
    const store = createLocalMediaStore({
      root: process.cwd(),
      publicBaseUrl: origin,
      signingSecret: secret,
    });
    const signed = await store.signRead(expectedKey);
    expect(
      verifyThumbnailPage(
        {
          items: [
            { id: recordId, coverThumbnail: signed.url },
            {
              id: '10000000-0000-4000-8000-000000000005',
              coverThumbnail: null,
            },
          ],
        },
        secret,
        origin,
      ),
    ).toEqual({ signed: 1, null: 1 });
    expect(verifyThumbnailPage({ items: [] }, secret, origin)).toEqual({
      signed: 0,
      null: 0,
    });
  });

  it('should detect a disabled signer and an owner-isolation decoy cover', () => {
    expect(() => verify(null)).toThrow('Missing thumbnail');
    expect(() =>
      verifyThumbnailPage(
        {
          items: [
            {
              id: '10000000-0000-4000-8000-000000000005',
              coverThumbnail: signedUrl(),
            },
          ],
        },
        secret,
        origin,
      ),
    ).toThrow('Expected null cover');
  });

  it('should reject signed later photos, foreign keys and upload tokens', () => {
    for (const overrides of [
      { key: 'synthetic-benchmark/thumbnails/2.jpg' },
      { key: 'foreign-decoy/record1.jpg' },
      { mode: 'upload' },
    ]) {
      expect(() => verify(signedUrl(overrides))).toThrow(
        'Wrong thumbnail target',
      );
    }
  });

  it('should reject malformed tokens, wrong origins and wrong transfer paths', () => {
    for (const url of [
      `${origin}/v1/storage/reads/.signature`,
      `${origin}/v1/storage/reads/body`,
      `${signedUrl()}.extra`,
    ]) {
      expect(() => verify(url)).toThrow('Malformed thumbnail token');
    }
    expect(() =>
      verify(signedUrl().replace(origin, 'https://other.invalid')),
    ).toThrow('Unexpected signed URL origin/path');
    expect(() => verify(signedUrl().replace('/reads/', '/uploads/'))).toThrow(
      'Unexpected signed URL origin/path',
    );
  });

  it('should reject tampering with either short or full-length signatures', () => {
    const body = signedUrl().split('.').slice(0, -1).join('.');
    expect(() => verify(`${body}.AA`)).toThrow('Thumbnail HMAC mismatch');
    expect(() =>
      verify(`${body}.${Buffer.alloc(32).toString('base64url')}`),
    ).toThrow('Thumbnail HMAC mismatch');
  });

  it('should reject expired, excessively long-lived and nonnumeric expiry', () => {
    for (const expiresAt of [now - 1, now + 300_001, 'invalid']) {
      expect(() => verify(signedUrl({ expiresAt }))).toThrow(
        'Unexpected thumbnail expiry',
      );
    }
  });
});
