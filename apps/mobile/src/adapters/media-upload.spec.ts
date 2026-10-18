import { describe, expect, it, jest } from '@jest/globals';

import { ApiError, ApiTransport } from '@antica/client';

import { uploadMedia } from './media-upload';

import type {
  LocalMedia,
  UploadLayout,
  UploadState,
  UploadStore,
} from './media-upload';

jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: async () => new Uint8Array(32),
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({
    size: 3,
    bytes: async () => new Uint8Array([1, 2, 3]),
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
const assetId = '00000000-0000-4000-8000-000000000031';
const completionKey = '00000000-0000-4000-8000-000000000041';
const future = '2099-01-01T00:00:00.000Z';
const past = '2000-01-01T00:00:00.000Z';

/**
 * builds a signed multipart part
 * @param partNumber part number from 1
 * @returns the signed part of one byte
 */
function signedPart(partNumber: number): {
  partNumber: number;
  offset: number;
  byteLength: number;
  putUrl: string;
  headers: Record<string, string>;
} {
  return {
    partNumber,
    offset: partNumber - 1,
    byteLength: 1,
    putUrl: `https://upload.example/${partNumber}`,
    headers: {},
  };
}

/**
 * builds a multipart session
 * @param partCount number of one-byte parts
 * @param expiresAt when the signed URLs expire
 * @returns a session whose parts each hold one byte
 */
function multipartSession(partCount: number, expiresAt = future): object {
  return {
    mode: 'multipart',
    assetId,
    expiresAt,
    uploadId: 'upload-1',
    parts: Array.from({ length: partCount }, (_, index) =>
      signedPart(index + 1),
    ).reverse(),
  };
}

const singleSession = {
  mode: 'single',
  assetId,
  expiresAt: future,
  putUrl: 'https://upload.example/single',
  headers: { 'Content-Type': 'image/jpeg' },
};

/**
 * builds an upload already started before the app closed
 * @param overrides fields that differ from a started single upload with nothing stored
 * @returns the persisted state
 */
function startedState(overrides: Partial<UploadState> = {}): UploadState {
  return {
    requestKey: media.id,
    assetId,
    layout: { mode: 'single' },
    etags: {},
    singleUploaded: false,
    completionRequestKey: completionKey,
    componentIds: [],
    ...overrides,
  };
}

/**
 * keeps upload state the way a journal does, recording every write
 * @param initial state found when the upload begins
 * @returns the store with its write history
 */
function recordingStore(initial: UploadState | null): {
  store: UploadStore;
  saves: UploadState[];
  current: () => UploadState | null;
} {
  let state = initial;
  const saves: UploadState[] = [];

  return {
    saves,
    current: () => state,
    store: {
      load: () => state,
      save: (next) => {
        state = next;
        saves.push(next);
      },
      clear: () => {
        state = null;
      },
    },
  };
}

/**
 * creates a transport whose requests are spied on
 * @returns a transport against a placeholder origin
 */
function transport(): ApiTransport {
  return new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
}

/**
 * builds an API error the server returns
 * @param status response status code
 * @param code public error code
 * @returns the rejection the transport raises
 */
function apiError(status: number, code: string): ApiError {
  return new ApiError({ status, code, message: code });
}

/**
 * builds a local file with its own identity, so in-memory state never leaks between tests
 * @param suffix last digits of the identifier
 * @returns a photo under a fresh identifier
 */
function localFile(suffix: string): LocalMedia {
  return { ...media, id: `00000000-0000-4000-8000-0000000000${suffix}` };
}

describe('fn:uploadMedia', () => {
  it('should retry only missing parts and preserve completion identity after a lost response', async () => {
    const local = localFile('50');
    const api = transport();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(multipartSession(2))
      .mockRejectedValueOnce(new Error('Completion response lost'))
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const uploads = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('"etag-one"')
      .mockRejectedValueOnce(new Error('Part lost'))
      .mockResolvedValueOnce('"etag-two"');
    const progress = jest.fn();

    await expect(uploadMedia(api, local, target, [target.id])).rejects.toThrow(
      'Part lost',
    );
    await expect(
      uploadMedia(api, local, target, [assetId], {
        onProgress: progress,
      }),
    ).rejects.toThrow('Completion response lost');
    await expect(uploadMedia(api, local, target, [])).resolves.toBe(assetId);

    expect(uploads.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/1',
      'https://upload.example/2',
      'https://upload.example/2',
    ]);
    expect(progress.mock.calls).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(commands.mock.calls.map(([path]) => path)).toEqual([
      '/v1/media/uploads',
      `/v1/media/${assetId}/complete`,
      `/v1/media/${assetId}/complete`,
    ]);
    expect(commands.mock.calls[0]?.[2]?.body).toMatchObject({
      componentIds: [target.id],
    });
    // PT-5: the retried completion repeats its key, so the asset completes once
    expect(commands.mock.calls[2]?.[2]).toEqual(commands.mock.calls[1]?.[2]);
    expect(commands.mock.calls[2]?.[2]?.body).toMatchObject({
      parts: [
        { partNumber: 1, etag: '"etag-one"' },
        { partNumber: 2, etag: '"etag-two"' },
      ],
    });
  });

  it('should complete a stored single upload for a source intake without sending its bytes again', async () => {
    const local = localFile('51');
    const api = transport();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(singleSession)
      .mockRejectedValueOnce(new Error('Completion response lost'))
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const uploads = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValue('single-etag');
    const intake = { kind: 'source_intake' as const, id: target.id };
    const progress = jest.fn();

    await expect(
      uploadMedia(api, local, intake, [], { onProgress: progress }),
    ).rejects.toThrow('Completion response lost');
    await expect(uploadMedia(api, local, intake, [])).resolves.toBe(assetId);

    expect(uploads).toHaveBeenCalledTimes(1);
    expect(uploads).toHaveBeenCalledWith(
      'https://upload.example/single',
      expect.any(Object),
      { 'Content-Type': 'image/jpeg' },
    );
    expect(progress.mock.calls).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(commands.mock.calls[0]?.[2]?.body).toMatchObject({
      target: { kind: 'source_intake', intakeKey: target.id },
      byteLength: 3,
      sha256:
        '0000000000000000000000000000000000000000000000000000000000000000',
    });
    expect(commands.mock.calls[1]?.[2]).toEqual(commands.mock.calls[2]?.[2]);
    expect(commands.mock.calls[1]?.[2]?.body).toEqual({
      requestKey: expect.any(String),
      parts: [],
    });
  });

  it('should re-sign an expired session for the same asset instead of starting another', async () => {
    const local = localFile('52');
    const api = transport();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ ...singleSession, expiresAt: past })
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const reads = jest.spyOn(api, 'get').mockResolvedValueOnce({
      ...singleSession,
      putUrl: 'https://upload.example/fresh',
      uploadedParts: [],
    });
    const uploads = jest.spyOn(api, 'putSigned').mockResolvedValue('etag');

    await expect(uploadMedia(api, local, target, [])).resolves.toBe(assetId);

    expect(reads).toHaveBeenCalledWith(
      `/v1/media/${assetId}/upload`,
      expect.anything(),
    );
    expect(uploads.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/fresh',
    ]);
    expect(commands.mock.calls.map(([path]) => path)).toEqual([
      '/v1/media/uploads',
      `/v1/media/${assetId}/complete`,
    ]);
  });

  it('should re-sign URLs that expire between attempts and send the file again', async () => {
    const local = localFile('53');
    const api = transport();
    jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce({
        ...singleSession,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      })
      .mockResolvedValueOnce({ state: 'ready', assetId });
    jest.spyOn(api, 'get').mockResolvedValueOnce({
      ...singleSession,
      putUrl: 'https://upload.example/fresh',
      uploadedParts: [],
    });
    const uploads = jest
      .spyOn(api, 'putSigned')
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce('etag');

    await expect(uploadMedia(api, local, target, [])).rejects.toThrow(
      'Connection lost',
    );
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 120_000);
    await expect(uploadMedia(api, local, target, [])).resolves.toBe(assetId);

    expect(uploads.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/single',
      'https://upload.example/fresh',
    ]);
  });

  it('should send only the parts storage lacks, taking its ETags over the journal', async () => {
    const api = transport();
    const { store, current } = recordingStore(
      startedState({
        layout: {
          mode: 'multipart',
          parts: [1, 2, 3].map((partNumber) => ({
            partNumber,
            offset: partNumber - 1,
            byteLength: 1,
          })),
        },
        etags: { '1': '"journal-1"', '2': '"journal-2"' },
      }),
    );
    jest.spyOn(api, 'get').mockResolvedValueOnce({
      ...multipartSession(3),
      uploadedParts: [{ partNumber: 1, etag: '"server-1"' }],
    });
    const uploads = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('"new-2"')
      .mockResolvedValueOnce('"new-3"');
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce({ state: 'ready', assetId });

    await expect(
      uploadMedia(api, localFile('54'), target, [], { store }),
    ).resolves.toBe(assetId);

    expect(uploads.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/2',
      'https://upload.example/3',
    ]);
    expect(commands.mock.calls[0]?.[2]).toEqual({
      body: {
        requestKey: completionKey,
        parts: [
          { partNumber: 1, etag: '"server-1"' },
          { partNumber: 2, etag: '"new-2"' },
          { partNumber: 3, etag: '"new-3"' },
        ],
      },
      idempotencyKey: completionKey,
    });
    expect(current()).toBeNull();
  });

  it('should write the journal after every stored part', async () => {
    const api = transport();
    const { store, saves } = recordingStore(null);
    jest.spyOn(api, 'post').mockResolvedValueOnce(multipartSession(2));
    jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('"one"')
      .mockRejectedValueOnce(new Error('App closed'));

    await expect(
      uploadMedia(api, localFile('55'), target, [target.id], { store }),
    ).rejects.toThrow('App closed');

    expect(saves.map((state) => [state.assetId, state.etags])).toEqual([
      [null, {}],
      [assetId, {}],
      [assetId, { '1': '"one"' }],
    ]);
    expect(saves.at(-1)?.componentIds).toEqual([target.id]);
  });

  it.each<{
    mode: string;
    layout: UploadLayout;
    etags: Record<string, string>;
    parts: Array<{ partNumber: number; etag: string }>;
  }>([
    { mode: 'single', layout: { mode: 'single' }, etags: {}, parts: [] },
    {
      mode: 'multipart',
      layout: {
        mode: 'multipart',
        parts: [
          { partNumber: 1, offset: 0, byteLength: 1 },
          { partNumber: 2, offset: 1, byteLength: 1 },
        ],
      },
      etags: { '1': '"one"' },
      parts: [{ partNumber: 1, etag: '"one"' }],
    },
  ])(
    'should complete a $mode upload storage already holds under its completion key',
    async ({ layout, etags, parts }) => {
      const api = transport();
      const { store } = recordingStore(startedState({ layout, etags }));
      jest
        .spyOn(api, 'get')
        .mockRejectedValueOnce(apiError(409, 'UPLOAD_STORED'));
      const uploads = jest.spyOn(api, 'putSigned');
      const commands = jest
        .spyOn(api, 'post')
        .mockResolvedValueOnce({ state: 'processing', assetId });

      await expect(
        uploadMedia(api, localFile('56'), target, [], { store }),
      ).resolves.toBe(assetId);

      expect(uploads).not.toHaveBeenCalled();
      expect(commands).toHaveBeenCalledTimes(1);
      expect(commands.mock.calls[0]?.[2]?.body).toEqual({
        requestKey: completionKey,
        parts,
      });
    },
  );

  it('should accept an upload the server already completed without uploading it again', async () => {
    const api = transport();
    const { store, current } = recordingStore(startedState());
    const reads = jest
      .spyOn(api, 'get')
      .mockRejectedValueOnce(apiError(409, 'UPLOAD_ALREADY_COMPLETED'))
      .mockResolvedValueOnce({ asset: { state: 'ready' } });
    const commands = jest.spyOn(api, 'post');

    await expect(
      uploadMedia(api, localFile('57'), target, [], { store }),
    ).resolves.toBe(assetId);

    expect(reads.mock.calls.map(([path]) => path)).toEqual([
      `/v1/media/${assetId}/upload`,
      `/v1/media/${assetId}`,
    ]);
    expect(commands).not.toHaveBeenCalled();
    expect(current()).toBeNull();
  });

  it('should fail an already completed upload whose file failed verification and start it afresh next time', async () => {
    const api = transport();
    const { store, current } = recordingStore(startedState());
    jest
      .spyOn(api, 'get')
      .mockRejectedValueOnce(apiError(409, 'UPLOAD_ALREADY_COMPLETED'))
      .mockResolvedValueOnce({ asset: { state: 'failed' } });

    await expect(
      uploadMedia(api, localFile('58'), target, [], { store }),
    ).rejects.toMatchObject({ code: 'UPLOAD_FAILED', status: 409 });

    expect(current()).toMatchObject({ assetId: null, etags: {} });
    expect(current()?.requestKey).not.toBe(media.id);
    expect(current()?.completionRequestKey).not.toBe(completionKey);
  });

  it('should start an expired upload again under a new request key', async () => {
    const api = transport();
    const { store } = recordingStore(
      startedState({ componentIds: [target.id] }),
    );
    jest
      .spyOn(api, 'get')
      .mockRejectedValueOnce(apiError(410, 'UPLOAD_EXPIRED'));
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(singleSession)
      .mockResolvedValueOnce({ state: 'ready', assetId });
    jest.spyOn(api, 'putSigned').mockResolvedValue('etag');

    await expect(
      uploadMedia(api, localFile('59'), target, [], { store }),
    ).resolves.toBe(assetId);

    const start = commands.mock.calls[0]?.[2];
    expect(commands.mock.calls[0]?.[0]).toBe('/v1/media/uploads');
    expect(start.idempotencyKey).not.toBe(media.id);
    expect(start.body).toMatchObject({ componentIds: [target.id] });
    expect(commands.mock.calls[1]?.[2]?.idempotencyKey).not.toBe(completionKey);
  });

  it('should keep the journal and report a resumption the server refuses', async () => {
    const api = transport();
    const { store, current } = recordingStore(startedState());
    jest.spyOn(api, 'get').mockRejectedValueOnce(apiError(404, 'NOT_FOUND'));

    await expect(
      uploadMedia(api, localFile('60'), target, [], { store }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    expect(current()).toMatchObject({ assetId, requestKey: media.id });
  });

  it('should rethrow a resumption that never reached the server', async () => {
    const api = transport();
    const { store, current } = recordingStore(startedState({ layout: null }));
    jest
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new TypeError('Network request failed'));

    await expect(
      uploadMedia(api, localFile('64'), target, [], { store }),
    ).rejects.toThrow('Network request failed');

    expect(current()).toMatchObject({ assetId, layout: null });
  });

  it('should ask storage again under a new completion key after an incomplete completion', async () => {
    const api = transport();
    const { store, current } = recordingStore(
      startedState({ singleUploaded: true }),
    );
    jest
      .spyOn(api, 'post')
      .mockRejectedValueOnce(apiError(409, 'UPLOAD_INCOMPLETE'));

    await expect(
      uploadMedia(api, localFile('61'), target, [], { store }),
    ).rejects.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });

    expect(current()).toMatchObject({ singleUploaded: false, etags: {} });
    expect(current()?.completionRequestKey).not.toBe(completionKey);
  });

  it('should re-sign URLs that expire part-way and give up when they keep expiring', async () => {
    const api = transport();
    const { store } = recordingStore(
      startedState({
        layout: {
          mode: 'multipart',
          parts: [{ partNumber: 1, offset: 0, byteLength: 1 }],
        },
      }),
    );
    const reads = jest.spyOn(api, 'get').mockResolvedValue({
      ...multipartSession(1),
      uploadedParts: [],
    });
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse(future) + 1);
    const uploads = jest.spyOn(api, 'putSigned');

    await expect(
      uploadMedia(api, localFile('62'), target, [], { store }),
    ).rejects.toMatchObject({ code: 'UPLOAD_EXPIRED', status: 410 });

    expect(reads).toHaveBeenCalledTimes(3);
    expect(uploads).not.toHaveBeenCalled();
  });

  it('should reject failed verification and retry with a new upload instead of accepting corrupt media', async () => {
    const local = localFile('63');
    const api = transport();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(singleSession)
      .mockResolvedValueOnce({ state: 'failed', assetId })
      .mockResolvedValueOnce(singleSession)
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const uploads = jest.spyOn(api, 'putSigned').mockResolvedValue('etag');

    await expect(uploadMedia(api, local, target, [])).rejects.toMatchObject({
      code: 'UPLOAD_FAILED',
      status: 409,
    });
    await expect(uploadMedia(api, local, target, [])).resolves.toBe(assetId);

    expect(uploads).toHaveBeenCalledTimes(2);
    expect(commands.mock.calls[2]?.[2]?.idempotencyKey).not.toBe(
      commands.mock.calls[0]?.[2]?.idempotencyKey,
    );
  });
});
