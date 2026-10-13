import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createLocalMediaStore } from './local.js';

const png = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
    'base64',
  ),
);
const original = {
  assetId: '00000000-0000-4000-8000-000000000001',
  key: 'originals/00000000-0000-4000-8000-000000000001',
  mimeType: 'image/png',
  byteLength: png.byteLength,
  sha256: createHash('sha256').update(png).digest('hex'),
};
const config = {
  publicBaseUrl: 'http://localhost:8080',
  signingSecret: 'acceptance-test-secret-at-least-32-characters',
};

describe('fn:createLocalMediaStore', () => {
  it('should reject the development store in production', () => {
    vi.stubEnv('NODE_ENV', 'production');

    expect(() =>
      createLocalMediaStore({ ...config, root: tmpdir() }),
    ).toThrow();
  });

  it('should reject a short signing secret before issuing transfer tokens', () => {
    expect(() =>
      createLocalMediaStore({
        ...config,
        root: tmpdir(),
        signingSecret: 'short',
      }),
    ).toThrow();
  });

  it('should validate a signed upload declaration before accepting bytes', async () => {
    const store = createLocalMediaStore({ ...config, root: tmpdir() });
    const signed = await store.signUpload(original);
    const token = new URL(signed.url).pathname.split('/').at(-1)!;
    const empty = await store.signUpload({ ...original, byteLength: 0 });

    expect(store.validateUploadToken(token)).toEqual({
      byteLength: png.byteLength,
      mimeType: 'image/png',
    });
    expect(() =>
      store.validateUploadToken(new URL(empty.url).pathname.split('/').at(-1)!),
    ).toThrow();
  });

  it('should reject incomplete tokens and signed traversal keys before reading files', async () => {
    const store = createLocalMediaStore({ ...config, root: tmpdir() });
    const traversal = await store.signRead('../outside');
    const token = new URL(traversal.url).pathname.split('/').at(-1)!;

    await expect(store.openReadToken('')).rejects.toThrow();
    await expect(store.openReadToken('body.')).rejects.toThrow();
    await expect(store.openReadToken(token)).rejects.toThrow();
  });

  it('should persist an immutable derivative and report unknown bytes as binary', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    const store = createLocalMediaStore({ ...config, root });
    const key =
      'derivatives/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
    const bytes = Uint8Array.from([1, 2, 3]);
    try {
      await store.writeDerivative({
        key,
        bytes,
        mimeType: 'application/octet-stream',
      });

      const stored = await store.read(key);
      expect({ ...stored, bytes: Uint8Array.from(stored.bytes) }).toEqual({
        bytes,
        mimeType: 'application/octet-stream',
      });
      await expect(
        store.writeDerivative({
          key,
          bytes,
          mimeType: 'application/octet-stream',
        }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should persist parser artifacts only under the artifact key space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    const store = createLocalMediaStore({ ...config, root });
    const key =
      'artifacts/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002';
    try {
      await expect(
        store.writeArtifact({
          key: 'derivatives/intruder',
          bytes: png,
          mimeType: 'image/png',
        }),
      ).rejects.toThrow();
      await store.writeArtifact({ key, bytes: png, mimeType: 'image/png' });

      expect(Uint8Array.from((await store.read(key)).bytes)).toEqual(png);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should refuse bytes whose content type differs from the signed upload', async () => {
    const store = createLocalMediaStore({ ...config, root: tmpdir() });
    const signed = await store.signUpload(original);
    const token = new URL(signed.url).pathname.split('/').at(-1)!;

    await expect(
      store.acceptUploadToken(token, png, 'image/jpeg'),
    ).rejects.toThrow();
  });

  it('should detect a stored original whose size differs from its declaration', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    const store = createLocalMediaStore({ ...config, root });
    try {
      const signed = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(signed.url).pathname.split('/').at(-1)!,
        png,
        original.mimeType,
      );

      await expect(
        store.verifyOriginal({ ...original, byteLength: png.byteLength + 1 }),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reopen immutable original bytes with a new store instance after a restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    try {
      const first = createLocalMediaStore({ ...config, root });
      const upload = await first.signUpload(original);
      await first.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        png,
        original.mimeType,
      );

      const reopened = createLocalMediaStore({ ...config, root });
      await reopened.verifyOriginal(original);
      const signed = await reopened.signRead(original.key);
      const result = await reopened.openReadToken(
        new URL(signed.url).pathname.split('/').at(-1)!,
      );

      expect({ ...result, bytes: Uint8Array.from(result.bytes) }).toEqual({
        bytes: png,
        mimeType: 'image/png',
      });
      await expect(
        first.acceptUploadToken(
          new URL(upload.url).pathname.split('/').at(-1)!,
          png,
          original.mimeType,
        ),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reject changing the signed object key to access a different private original', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    try {
      const store = createLocalMediaStore({ ...config, root });
      const other = { ...original, key: 'originals/private-other' };
      const otherUpload = await store.signUpload(other);
      await store.acceptUploadToken(
        new URL(otherUpload.url).pathname.split('/').at(-1)!,
        png,
        other.mimeType,
      );
      const signed = await store.signRead(original.key);
      const [body, signature] = new URL(signed.url).pathname
        .split('/')
        .at(-1)!
        .split('.');
      const forgedBody = Buffer.from(
        Buffer.from(body!, 'base64url')
          .toString()
          .replace(original.key, 'originals/private-other'),
      ).toString('base64url');

      await expect(
        store.openReadToken(`${forgedBody}.${signature}`),
      ).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reject expired read tokens and prohibit read authorization for uploads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'antica-media-'));
    try {
      const store = createLocalMediaStore({ ...config, root });
      const upload = await store.signUpload(original);
      await store.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        png,
        original.mimeType,
      );
      const signed = await store.signRead(original.key);
      const token = new URL(signed.url).pathname.split('/').at(-1)!;

      await expect(
        store.acceptUploadToken(token, png, original.mimeType),
      ).rejects.toThrow();
      vi.spyOn(Date, 'now').mockReturnValueOnce(
        new Date(signed.expiresAt).getTime(),
      );
      await expect(store.openReadToken(token)).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
