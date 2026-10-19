import { describe, expect, it, jest } from '@jest/globals';

import { ApiTransport } from '@antica/client';

import { uploadMedia } from './media-upload';

import type { LocalMedia } from './media-upload';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: async () => new Uint8Array(32),
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({
    size: 2,
    bytes: async () => new Uint8Array([1, 2]),
    slice: () => new Blob(),
  })),
}));

const media: LocalMedia = {
  id: '00000000-0000-4000-8000-000000000021',
  uri: 'file:///photo.jpg',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  kind: 'photo',
  purpose: 'object',
  componentLabel: '',
  state: 'local',
  assetId: null,
};
const target = {
  kind: 'record' as const,
  id: '00000000-0000-4000-8000-000000000001',
};

const uploadSession = {
  mode: 'multipart',
  assetId: media.id,
  expiresAt: '2099-01-01T00:00:00.000Z',
  parts: [
    {
      partNumber: 1,
      offset: 0,
      byteLength: 1,
      putUrl: 'https://upload.example/1',
      headers: {},
    },
    {
      partNumber: 2,
      offset: 1,
      byteLength: 1,
      putUrl: 'https://upload.example/2',
      headers: {},
    },
  ],
};

describe('Multipart upload recovery', () => {
  it('should retry only missing parts and preserve completion identity after a lost response', async () => {
    const api = new ApiTransport({
      baseUrl: 'https://api.example',
      session: { getCookie: async () => '', onUnauthorized: () => undefined },
    });
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(uploadSession)
      .mockRejectedValueOnce(new Error('Completion response lost'))
      .mockResolvedValueOnce({ state: 'ready', assetId: media.id });
    const uploads = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('etag-one')
      .mockRejectedValueOnce(new Error('Part lost'))
      .mockResolvedValueOnce('etag-two');

    await expect(uploadMedia(api, media, target, [])).rejects.toThrow(
      'Part lost',
    );
    await expect(uploadMedia(api, media, target, [])).rejects.toThrow(
      'Completion response lost',
    );
    await expect(uploadMedia(api, media, target, [])).resolves.toBe(media.id);

    expect(uploads.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/1',
      'https://upload.example/2',
      'https://upload.example/2',
    ]);
    expect(commands.mock.calls.map(([path]) => path)).toEqual([
      '/v1/media/uploads',
      `/v1/media/${media.id}/complete`,
      `/v1/media/${media.id}/complete`,
    ]);
    expect(commands.mock.calls[2]?.[2]).toEqual(commands.mock.calls[1]?.[2]);
    expect(commands.mock.calls[2]?.[2]?.body).toMatchObject({
      parts: [
        { partNumber: 1, etag: 'etag-one' },
        { partNumber: 2, etag: 'etag-two' },
      ],
    });
  });
});

it('should resume a completed single upload for a source intake without reuploading expired bytes', async () => {
  const local = { ...media, id: '00000000-0000-4000-8000-000000000022' };
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
  const commands = jest
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      mode: 'single',
      assetId: local.id,
      expiresAt: '2000-01-01T00:00:00.000Z',
      putUrl: 'https://upload.example/single',
      headers: { 'Content-Type': 'image/jpeg' },
    })
    .mockRejectedValueOnce(new Error('Completion response lost'))
    .mockResolvedValueOnce({ state: 'ready', assetId: local.id });
  const uploads = jest.spyOn(api, 'putSigned').mockResolvedValue('single-etag');
  const intake = { kind: 'source_intake' as const, id: target.id };

  await expect(uploadMedia(api, local, intake, [])).rejects.toThrow(
    'Completion response lost',
  );
  await expect(uploadMedia(api, local, intake, [])).resolves.toBe(local.id);

  expect(uploads).toHaveBeenCalledTimes(1);
  expect(uploads).toHaveBeenCalledWith(
    'https://upload.example/single',
    expect.any(Object),
    { 'Content-Type': 'image/jpeg' },
  );
  expect(commands.mock.calls[0]?.[2]?.body).toMatchObject({
    target: { kind: 'source_intake', intakeKey: target.id },
    sha256: '0000000000000000000000000000000000000000000000000000000000000000',
  });
  expect(commands.mock.calls[1]?.[2]).toEqual(commands.mock.calls[2]?.[2]);
});

it('should replace an expired unfinished upload with a fresh session and request identity', async () => {
  const local = { ...media, id: '00000000-0000-4000-8000-000000000023' };
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
  const session = { mode: 'single', assetId: local.id, headers: {} };
  const commands = jest
    .spyOn(api, 'post')
    .mockResolvedValueOnce({
      ...session,
      expiresAt: '2000-01-01T00:00:00.000Z',
      putUrl: 'https://upload.example/expired',
    })
    .mockResolvedValueOnce({
      ...session,
      expiresAt: '2099-01-01T00:00:00.000Z',
      putUrl: 'https://upload.example/fresh',
    })
    .mockResolvedValueOnce({ state: 'ready', assetId: local.id });
  const uploads = jest
    .spyOn(api, 'putSigned')
    .mockRejectedValueOnce(new Error('Upload expired'))
    .mockResolvedValueOnce('fresh-etag');

  await expect(uploadMedia(api, local, target, [])).rejects.toThrow(
    'Upload expired',
  );
  await expect(uploadMedia(api, local, target, [])).resolves.toBe(local.id);

  expect(uploads.mock.calls.map(([url]) => url)).toEqual([
    'https://upload.example/expired',
    'https://upload.example/fresh',
  ]);
  expect(commands.mock.calls[1]?.[2]?.idempotencyKey).not.toBe(
    commands.mock.calls[0]?.[2]?.idempotencyKey,
  );
});

it('should reject failed verification and retry with a new upload instead of accepting corrupt media', async () => {
  const local = { ...media, id: '00000000-0000-4000-8000-000000000024' };
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
  const session = {
    mode: 'single',
    assetId: local.id,
    headers: {},
    expiresAt: '2099-01-01T00:00:00.000Z',
    putUrl: 'https://upload.example/single',
  };
  const commands = jest
    .spyOn(api, 'post')
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce({ state: 'failed', assetId: local.id })
    .mockResolvedValueOnce(session)
    .mockResolvedValueOnce({ state: 'ready', assetId: local.id });
  const uploads = jest.spyOn(api, 'putSigned').mockResolvedValue('etag');

  await expect(uploadMedia(api, local, target, [])).rejects.toMatchObject({
    code: 'UPLOAD_FAILED',
    status: 409,
  });
  await expect(uploadMedia(api, local, target, [])).resolves.toBe(local.id);

  expect(uploads).toHaveBeenCalledTimes(2);
  expect(commands.mock.calls[2]?.[2]?.idempotencyKey).not.toBe(
    commands.mock.calls[0]?.[2]?.idempotencyKey,
  );
});
