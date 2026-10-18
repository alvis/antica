import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { ApiTransport } from '@antica/client';

import { fakeDisk, resetFakeDisk } from './file-system.spec.fixtures';
import {
  claimRecord,
  cleanJournals,
  discardFile,
  discardRecord,
  journalStore,
  keepFile,
  keptCopies,
  listJournals,
  restoreFiles,
  subscribeJournals,
  unfinishedUploads,
  updateJournal,
} from './upload-journal';

import type { LocalMedia } from './media-upload';
import type { UploadJournalEntry } from './upload-journal';

jest.mock('expo-file-system', () =>
  jest.requireActual('./file-system.spec.fixtures'),
);
jest.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
  digest: async () => new Uint8Array(32),
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const recordId = '00000000-0000-4000-8000-000000000001';
const otherRecordId = '00000000-0000-4000-8000-000000000002';
const assetId = '00000000-0000-4000-8000-000000000031';
const userId = 'collector-1';
const scope = { userId, recordId };
const uploads = `file:///documents/uploads/${userId}`;

/**
 * builds a draft photo whose original sits in the cache
 * @param id file identifier
 * @param overrides fields that differ from a local photo
 * @returns the draft photo
 */
function photo(id: string, overrides: Partial<LocalMedia> = {}): LocalMedia {
  return {
    id,
    uri: `file:///cache/${id}.jpg`,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    ...overrides,
  };
}

/**
 * puts an original into the fake cache and keeps it with a journal
 * @param id file identifier
 * @param overrides fields that differ from a local photo
 * @param record record receiving the file
 * @returns the kept file
 */
async function kept(
  id: string,
  overrides: Partial<LocalMedia> = {},
  record = recordId,
): Promise<LocalMedia> {
  fakeDisk().files.set(`file:///cache/${id}.jpg`, 'abc');
  const file = await keepFile(photo(id, overrides), {
    userId,
    recordId: record,
    label: 'Celadon bowl',
  });
  if (!file) {
    throw new Error('Expected the file to be kept');
  }

  return file;
}

/**
 * reads a journal straight from the fake disk
 * @param fileId file identifier
 * @param record record receiving the file
 * @returns the parsed journal
 */
function journalOf(fileId: string, record = recordId): UploadJournalEntry {
  return JSON.parse(
    String(fakeDisk().files.get(`${uploads}/${record}/${fileId}/journal.json`)),
  ) as UploadJournalEntry;
}

/**
 * writes raw journal content for a file directory
 * @param fileId directory name
 * @param content journal text
 */
function writeRaw(fileId: string, content: string): void {
  const { files, directories } = fakeDisk();
  directories.add(uploads);
  directories.add(`${uploads}/${recordId}`);
  directories.add(`${uploads}/${recordId}/${fileId}`);
  files.set(`${uploads}/${recordId}/${fileId}/journal.json`, content);
}

beforeEach(() => resetFakeDisk());

describe('fn:keepFile', () => {
  it('should copy the original into the documents directory with a local journal', async () => {
    const file = await kept('file-1', {
      name: 'vase.HEIC',
      componentLabel: 'Lid',
      checkRequestKey: 'check-key',
      excluded: true,
    });

    expect(file.copyUri).toBe(`${uploads}/${recordId}/file-1/original.HEIC`);
    expect(fakeDisk().files.get(file.copyUri!)).toBe('abc');
    expect(journalOf('file-1')).toMatchObject({
      version: 1,
      fileId: 'file-1',
      recordId,
      recordLabel: 'Celadon bowl',
      copyUri: file.copyUri,
      name: 'vase.HEIC',
      componentLabel: 'Lid',
      checkRequestKey: 'check-key',
      excluded: true,
      state: 'local',
      requestKey: 'file-1',
      assetId: null,
      etags: {},
      lastErrorCode: null,
    });
    expect(
      fakeDisk().files.has(`${uploads}/${recordId}/file-1/journal.json.tmp`),
    ).toBe(false);
  });

  it('should keep a file without an extension and without a check key', async () => {
    const file = await kept('file-2', { name: 'scan' });

    expect(file.copyUri).toBe(`${uploads}/${recordId}/file-2/original`);
    expect(journalOf('file-2')).toMatchObject({
      checkRequestKey: null,
      excluded: false,
    });
  });

  it('should keep nothing when an identifier is not a safe directory name', async () => {
    await expect(
      keepFile(photo('../escape'), { userId, recordId, label: 'x' }),
    ).resolves.toBeNull();
    await expect(
      keepFile(photo('file-3'), { userId, recordId: '../escape', label: 'x' }),
    ).resolves.toBeNull();

    expect(fakeDisk().files.size).toBe(0);
  });

  it('should leave the file without restart protection when its copy cannot be made', async () => {
    await expect(
      keepFile(photo('missing'), { userId, recordId, label: 'x' }),
    ).resolves.toBeNull();
    fakeDisk().failing.add('write');

    await expect(
      keepFile(photo('file-4'), { userId, recordId, label: 'x' }),
    ).resolves.toBeNull();
  });
});

describe('fn:updateJournal', () => {
  it('should mirror draft edits into the journal', async () => {
    await kept('file-5');

    updateJournal(scope, 'file-5', {
      recordLabel: 'AC-0001',
      componentLabel: 'Base',
      excluded: false,
      state: 'failed',
      lastErrorCode: 'NETWORK',
    });

    expect(journalOf('file-5')).toMatchObject({
      recordLabel: 'AC-0001',
      componentLabel: 'Base',
      state: 'failed',
      lastErrorCode: 'NETWORK',
    });
  });

  it('should keep the previous journal whole when a write is cut short', async () => {
    await kept('file-6');
    fakeDisk().failing.add('move');

    updateJournal(scope, 'file-6', {
      recordLabel: 'Torn',
      componentLabel: '',
      excluded: false,
      state: 'uploading',
      lastErrorCode: null,
    });

    expect(journalOf('file-6')).toMatchObject({
      recordLabel: 'Celadon bowl',
      state: 'local',
    });
    expect(listJournals(userId).entries.map((entry) => entry.fileId)).toEqual([
      'file-6',
    ]);
  });

  it('should never recreate a journal that was already removed', () => {
    updateJournal(scope, 'gone', {
      recordLabel: '',
      componentLabel: '',
      excluded: false,
      state: 'local',
      lastErrorCode: null,
    });

    expect(fakeDisk().files.size).toBe(0);
  });
});

describe('fn:journalStore', () => {
  it('should load, save and clear upload state through the journal', async () => {
    await kept('file-7');
    await kept('file-8');
    const listener = jest.fn();
    const stop = subscribeJournals(listener);
    const store = journalStore(scope, 'file-7');

    expect(store.load()).toMatchObject({ requestKey: 'file-7', assetId: null });
    store.save({
      ...store.load()!,
      assetId,
      layout: { mode: 'single' },
      componentIds: [],
    });
    expect(journalOf('file-7')).toMatchObject({
      assetId,
      layout: { mode: 'single' },
      name: 'file-7.jpg',
    });
    store.clear();

    expect(journalStore(scope, 'file-7').load()).toBeNull();
    expect(fakeDisk().directories.has(`${uploads}/${recordId}`)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    journalStore(scope, 'file-8').clear();
    expect(fakeDisk().directories.has(`${uploads}/${recordId}`)).toBe(false);
    stop();
    discardFile(scope, 'file-8');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('should report a discard that could not delete the copy', async () => {
    await kept('file-9');
    fakeDisk().failing.add('delete');
    const listener = jest.fn();
    const stop = subscribeJournals(listener);

    discardFile(scope, 'file-9');
    discardRecord(scope);

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listJournals(userId).entries).toHaveLength(1);
    stop();
  });
});

describe('fn:listJournals', () => {
  it('should find nothing before any file was kept', () => {
    expect(listJournals(userId).entries).toEqual([]);
  });

  it('should report apart the directories whose journal it cannot use, never as uploads', async () => {
    await kept('file-10');
    const valid = journalOf('file-10');
    const broken = {
      'torn': '{"version":1,',
      'future': { ...valid, version: 2 },
      'null': null,
      'no-etags': { ...valid, etags: null },
      'bad-state': { ...valid, state: 'x' },
      'no-name': { ...valid, name: 1 },
      'bad-asset': { ...valid, assetId: 5 },
      'text-layout': { ...valid, layout: 'single' },
      'no-parts': { ...valid, layout: { mode: 'multipart', parts: 'x' } },
      'null-part': { ...valid, layout: { mode: 'multipart', parts: [null] } },
      'bad-part': {
        ...valid,
        layout: {
          mode: 'multipart',
          parts: [{ partNumber: 1, offset: 0, byteLength: '1' }],
        },
      },
      'odd-mode': { ...valid, layout: { mode: 'stream' } },
    };
    for (const [fileId, content] of Object.entries(broken)) {
      writeRaw(
        fileId,
        typeof content === 'string' ? content : JSON.stringify(content),
      );
    }
    writeRaw(
      'multipart',
      JSON.stringify({
        ...valid,
        fileId: 'multipart',
        assetId,
        layout: {
          mode: 'multipart',
          parts: [{ partNumber: 1, offset: 0, byteLength: 1 }],
        },
      }),
    );
    fakeDisk().directories.add(`${uploads}/${recordId}/empty`);
    fakeDisk().files.set(`${uploads}/stray.json`, '{}');
    fakeDisk().files.set(`${uploads}/${recordId}/stray.json`, '{}');

    const listing = listJournals(userId);

    expect(listing.entries.map((entry) => entry.fileId).sort()).toEqual([
      'file-10',
      'multipart',
    ]);
    expect(listing.unreadable.map((folder) => folder.fileId).sort()).toEqual(
      [...Object.keys(broken), 'empty'].sort(),
    );
    expect(listing.unreadable[0]).toEqual({
      userId,
      recordId,
      fileId: expect.any(String),
    });
    expect(
      restoreFiles(scope)
        .map((file) => file.id)
        .sort(),
    ).toEqual(['file-10', 'multipart']);
  });

  it("should never show another collector's journals, nor any for an unsafe identifier", async () => {
    await kept('file-12');

    expect(listJournals('collector-2')).toEqual({
      entries: [],
      unreadable: [],
    });
    expect(unfinishedUploads('collector-2')).toEqual([]);
    expect(listJournals('../collector-1').entries).toEqual([]);
    expect(listJournals('').entries).toEqual([]);
    await expect(
      keepFile(photo('file-13'), { userId: '..', recordId, label: 'x' }),
    ).resolves.toBeNull();
  });

  it('should find nothing in a documents directory it cannot read', async () => {
    await kept('file-11');
    fakeDisk().failing.add('list');

    expect(listJournals(userId).entries).toEqual([]);
  });
});

describe('fn:restoreFiles', () => {
  it('should rebuild the draft files of one record from their copies, oldest first', async () => {
    const now = jest.spyOn(Date.prototype, 'toISOString');
    now.mockReturnValueOnce('2026-10-18T10:00:02.000Z');
    await kept('late', { componentLabel: 'Lid', checkRequestKey: 'key' });
    now.mockReturnValueOnce('2026-10-18T10:00:01.000Z');
    await kept('early', { excluded: true });
    await kept('elsewhere', {}, otherRecordId);
    updateJournal(scope, 'late', {
      recordLabel: 'Celadon bowl',
      componentLabel: 'Lid',
      excluded: false,
      state: 'failed',
      lastErrorCode: 'NETWORK',
    });
    updateJournal(scope, 'early', {
      recordLabel: 'Celadon bowl',
      componentLabel: '',
      excluded: true,
      state: 'uploading',
      lastErrorCode: null,
    });

    expect(restoreFiles(scope)).toEqual([
      {
        id: 'early',
        uri: `${uploads}/${recordId}/early/original.jpg`,
        copyUri: `${uploads}/${recordId}/early/original.jpg`,
        name: 'early.jpg',
        mimeType: 'image/jpeg',
        kind: 'photo',
        purpose: 'object',
        componentLabel: '',
        state: 'local',
        assetId: null,
        excluded: true,
      },
      {
        id: 'late',
        uri: `${uploads}/${recordId}/late/original.jpg`,
        copyUri: `${uploads}/${recordId}/late/original.jpg`,
        name: 'late.jpg',
        mimeType: 'image/jpeg',
        kind: 'photo',
        purpose: 'object',
        componentLabel: 'Lid',
        state: 'failed',
        assetId: null,
        checkRequestKey: 'key',
        errorCode: 'NETWORK',
      },
    ]);
  });
});

describe('fn:unfinishedUploads', () => {
  it('should count unfinished files by record, the most recent first, leaving out open drafts', async () => {
    const now = jest.spyOn(Date.prototype, 'toISOString');
    now.mockReturnValueOnce('2026-10-18T10:00:03.000Z');
    await kept('a1');
    now.mockReturnValueOnce('2026-10-18T10:00:01.000Z');
    await kept('a2');
    now.mockReturnValueOnce('2026-10-18T10:00:02.000Z');
    await kept('b1', {}, otherRecordId);
    now.mockReturnValueOnce('2026-10-18T10:00:04.000Z');
    await kept('b2', { excluded: true }, otherRecordId);

    expect(unfinishedUploads(userId)).toEqual([
      { userId, recordId, recordLabel: 'Celadon bowl', count: 2 },
      {
        userId,
        recordId: otherRecordId,
        recordLabel: 'Celadon bowl',
        count: 1,
      },
    ]);
    const first = claimRecord(recordId);
    const second = claimRecord(recordId);
    first();
    first();
    expect(unfinishedUploads(userId).map((group) => group.recordId)).toEqual([
      otherRecordId,
    ]);
    second();
    expect(unfinishedUploads(userId)).toHaveLength(2);
    discardRecord(scope);
    expect(unfinishedUploads(userId).map((group) => group.recordId)).toEqual([
      otherRecordId,
    ]);
  });
});

describe('Atomic journal writes', () => {
  const edit = {
    recordLabel: 'AC-0001',
    componentLabel: 'Base',
    excluded: false,
    state: 'uploading' as const,
    lastErrorCode: null,
  };
  const journalUri = `${uploads}/${recordId}/file-14/journal.json`;

  it('should promote the next journal when a move was cut between deleting and renaming', async () => {
    await kept('file-14');
    fakeDisk().failing.add('rename');
    updateJournal(scope, 'file-14', edit);
    expect(fakeDisk().files.has(journalUri)).toBe(false);
    fakeDisk().failing.delete('rename');

    expect(listJournals(userId).entries).toEqual([
      expect.objectContaining({ fileId: 'file-14', recordLabel: 'AC-0001' }),
    ]);
    expect(journalOf('file-14')).toMatchObject({ componentLabel: 'Base' });
    expect(fakeDisk().files.has(`${journalUri}.tmp`)).toBe(false);
  });

  it('should read the next journal in place until it can be promoted', async () => {
    await kept('file-14');
    fakeDisk().failing.add('rename');
    updateJournal(scope, 'file-14', edit);
    fakeDisk().failing.add('move');

    expect(journalStore(scope, 'file-14').load()).toMatchObject({
      requestKey: 'file-14',
    });
    expect(fakeDisk().files.has(`${journalUri}.tmp`)).toBe(true);
    fakeDisk().failing.clear();
    expect(restoreFiles(scope)).toHaveLength(1);
    expect(fakeDisk().files.has(journalUri)).toBe(true);
  });

  it('should treat a lone torn temporary file as an unusable journal', async () => {
    await kept('file-14');
    fakeDisk().files.delete(journalUri);
    fakeDisk().files.set(`${journalUri}.tmp`, '{"version":');

    expect(listJournals(userId)).toEqual({
      entries: [],
      unreadable: [{ userId, recordId, fileId: 'file-14' }],
    });
  });
});

describe('fn:cleanJournals', () => {
  it('should delete unusable directories with their copies, sparing open drafts and usable journals', async () => {
    await kept('usable');
    await kept('torn');
    await kept('open', {}, otherRecordId);
    fakeDisk().files.set(`${uploads}/${recordId}/torn/journal.json`, '{');
    fakeDisk().files.set(`${uploads}/${otherRecordId}/open/journal.json`, '{');
    const release = claimRecord(otherRecordId);

    cleanJournals(userId);

    expect(
      fakeDisk().files.has(`${uploads}/${recordId}/torn/original.jpg`),
    ).toBe(false);
    expect(listJournals(userId)).toEqual({
      entries: [expect.objectContaining({ fileId: 'usable' })],
      unreadable: [{ userId, recordId: otherRecordId, fileId: 'open' }],
    });
    release();
    cleanJournals(userId);
    expect(listJournals(userId).unreadable).toEqual([]);
  });
});

describe('fn:keptCopies', () => {
  it('should wait for copies still being made and forget the discarded ones', async () => {
    fakeDisk().files.set('file:///cache/slow.jpg', 'abc');
    const copying = keepFile(photo('slow'), {
      userId,
      recordId,
      label: 'x',
    });
    void keepFile(photo('../escape'), { userId, recordId, label: 'x' });

    const copies = await keptCopies(['slow', '../escape', 'unknown']);

    expect(copies).toEqual(
      new Map([
        ['slow', `${uploads}/${recordId}/slow/original.jpg`],
        ['../escape', null],
      ]),
    );
    await expect(copying).resolves.toMatchObject({ id: 'slow' });
    discardFile(scope, 'slow');
    await expect(keptCopies(['slow'])).resolves.toEqual(new Map());
  });
});

/** modules of one app process, loaded in their own registry */
interface ColdStart {
  engine: typeof import('./media-upload');
  journal: typeof import('./upload-journal');
}

/**
 * loads the upload modules in a fresh registry, as a cold start does
 * @returns the engine and journal of the new process
 */
function coldStart(): ColdStart {
  let modules: ColdStart | undefined;
  jest.isolateModules(() => {
    modules = {
      engine:
        jest.requireActual<typeof import('./media-upload')>('./media-upload'),
      journal:
        jest.requireActual<typeof import('./upload-journal')>(
          './upload-journal',
        ),
    };
  });

  return modules!;
}

/**
 * builds a transport whose calls the restart specs script, with a three-part session
 * @returns the transport and the session its start returns
 */
function restartBoundary(): {
  api: ApiTransport;
  session: Record<string, unknown>;
} {
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
  const session = {
    mode: 'multipart',
    assetId,
    expiresAt: '2099-01-01T00:00:00.000Z',
    uploadId: 'upload-1',
    parts: [1, 2, 3].map((partNumber) => ({
      partNumber,
      offset: partNumber - 1,
      byteLength: 1,
      putUrl: `https://upload.example/${partNumber}`,
      headers: {},
    })),
  };

  return { api, session };
}

/**
 * uploads a kept file through the journal of one process
 * @param modules engine and journal of the process
 * @param api scripted transport
 * @param file kept file
 * @returns the uploaded asset
 */
async function uploadIn(
  modules: ColdStart,
  api: ApiTransport,
  file: LocalMedia,
): Promise<string> {
  return modules.engine.uploadMedia(
    api,
    { ...file, uri: file.copyUri! },
    { kind: 'record', id: recordId },
    [],
    { store: modules.journal.journalStore(scope, file.id) },
  );
}

describe('Upload resumption after a restart', () => {
  it('should resume with a fresh memory, send only the missing parts and complete once (PT-5)', async () => {
    const file = await kept('00000000-0000-4000-8000-000000000021');
    const { api, session } = restartBoundary();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const transfers = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('"one"')
      .mockRejectedValueOnce(new Error('App killed'))
      .mockResolvedValueOnce('"two"')
      .mockResolvedValueOnce('"three"');
    const reads = jest.spyOn(api, 'get').mockResolvedValueOnce({
      ...session,
      uploadedParts: [{ partNumber: 1, etag: '"one"' }],
    });

    await expect(uploadIn(coldStart(), api, file)).rejects.toThrow(
      'App killed',
    );
    const killed = journalOf(file.id);
    expect(killed).toMatchObject({ assetId, etags: { '1': '"one"' } });

    const second = coldStart();
    expect(second.journal.unfinishedUploads(userId)).toEqual([
      { userId, recordId, recordLabel: 'Celadon bowl', count: 1 },
    ]);
    await expect(uploadIn(second, api, file)).resolves.toBe(assetId);

    expect(reads).toHaveBeenCalledTimes(1);
    expect(transfers.mock.calls.map(([url]) => url)).toEqual([
      'https://upload.example/1',
      'https://upload.example/2',
      'https://upload.example/2',
      'https://upload.example/3',
    ]);
    expect(commands.mock.calls.map(([path]) => path)).toEqual([
      '/v1/media/uploads',
      `/v1/media/${assetId}/complete`,
    ]);
    expect(commands.mock.calls[1]?.[2]).toEqual({
      body: {
        requestKey: killed.completionRequestKey,
        parts: [
          { partNumber: 1, etag: '"one"' },
          { partNumber: 2, etag: '"two"' },
          { partNumber: 3, etag: '"three"' },
        ],
      },
      idempotencyKey: killed.completionRequestKey,
    });
    expect(second.journal.listJournals(userId).entries).toEqual([]);
    expect(fakeDisk().files.has(file.copyUri!)).toBe(false);
  });

  it('should send again a part the journal recorded but storage lacks, since the server wins', async () => {
    const file = await kept('00000000-0000-4000-8000-000000000022');
    const { api, session } = restartBoundary();
    const commands = jest
      .spyOn(api, 'post')
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ state: 'ready', assetId });
    const transfers = jest
      .spyOn(api, 'putSigned')
      .mockResolvedValueOnce('"one"')
      .mockResolvedValueOnce('"two"')
      .mockRejectedValueOnce(new Error('App killed'))
      .mockResolvedValueOnce('"two-again"')
      .mockResolvedValueOnce('"three"');
    jest.spyOn(api, 'get').mockResolvedValueOnce({
      ...session,
      uploadedParts: [{ partNumber: 1, etag: '"one"' }],
    });

    await expect(uploadIn(coldStart(), api, file)).rejects.toThrow(
      'App killed',
    );
    expect(journalOf(file.id).etags).toEqual({ '1': '"one"', '2': '"two"' });
    await expect(uploadIn(coldStart(), api, file)).resolves.toBe(assetId);

    expect(transfers.mock.calls.map(([url]) => url).slice(3)).toEqual([
      'https://upload.example/2',
      'https://upload.example/3',
    ]);
    expect(commands.mock.calls[1]?.[2]).toMatchObject({
      body: {
        parts: [
          { partNumber: 1, etag: '"one"' },
          { partNumber: 2, etag: '"two-again"' },
          { partNumber: 3, etag: '"three"' },
        ],
      },
    });
  });
});
