import { describe, expect, it, vi } from 'vitest';

import { ComponentInUseError } from '../ports/index.js';

import { createRecordService } from './service.js';

import type {
  RecordCreate,
  RecordDetail,
  RecordPatch,
  CursorPage,
  RecordSummary,
} from '@antica/contracts';

import type { MediaStoragePort } from '../evidence/media.js';
import type {
  CommandReceipt,
  CommandRepository,
  OperationResult,
  RecordRepository,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

const ownerId = 'collector-1';
const now = '2026-10-13T12:00:00.000Z';
const createInput = { unitKind: 'single' } satisfies RecordCreate;

function createFixture(
  options: {
    readonly record?: RecordDetail | null;
    readonly patchResult?: RecordDetail | null;
    readonly patchError?: Error;
    readonly page?: CursorPage<RecordSummary>;
    readonly thumbnailTargets?: Awaited<
      ReturnType<RecordRepository['getThumbnailTargets']>
    >;
    readonly storage?: Pick<MediaStoragePort, 'signRead'>;
  } = {},
) {
  const records = new Map<string, RecordDetail>();
  if (options.record) {
    records.set(options.record.id, options.record);
  }
  const receipts = new Map<string, CommandReceipt>();
  const create = vi.fn(async (record: RecordDetail) => {
    records.set(record.id, record);
  });
  const patch = vi.fn(
    async (
      id: string,
      input: RecordPatch,
      versions: Pick<
        RecordDetail,
        'recordRevision' | 'analysisInputVersion' | 'evidenceVersion'
      >,
    ) => {
      if (options.patchError) {
        throw options.patchError;
      }
      if ('patchResult' in options) {
        return options.patchResult ?? null;
      }
      const current = records.get(id);
      if (!current) {
        return null;
      }
      const updated = {
        ...current,
        ...input.fields,
        ...versions,
        updatedAt: now,
      };
      records.set(id, updated);

      return updated;
    },
  );
  const recordRepository: RecordRepository = {
    allocateCode: vi.fn(async () => 'ANT-0001'),
    get: vi.fn(async (id) => records.get(id) ?? null),
    query: vi.fn(async () => options.page ?? { items: [], nextCursor: null }),
    getThumbnailTargets: vi.fn(async () => options.thumbnailTargets ?? []),
    create,
    patch,
    bumpVersions: vi.fn(async () => null),
  };
  const commands: CommandRepository = {
    get: vi.fn(
      async (_owner, operation, key) =>
        receipts.get(`${operation}:${key}`) ?? null,
    ),
    insert: vi.fn(async (receipt) => {
      receipts.set(`${receipt.operation}:${receipt.requestKey}`, receipt);
    }),
  };
  const unit = new Proxy(
    { records: recordRepository, commands },
    {
      get(target, property) {
        if (property in target) {
          return Reflect.get(target, property);
        }
        throw new Error(`Unexpected repository: ${String(property)}`);
      },
    },
  ) as UnitOfWork;
  const owners = vi.fn<(owner: string) => void>();
  let inTransaction = false;
  const transaction: TransactionPort = {
    run: async <T extends OperationResult<unknown>>(
      owner: string,
      operation: (work: UnitOfWork) => Promise<T>,
    ): Promise<T> => {
      owners(owner);
      inTransaction = true;
      try {
        return await operation(unit);
      } finally {
        inTransaction = false;
      }
    },
  };
  const service = createRecordService(
    transaction,
    { now: () => now },
    { create: () => 'record-1' },
    options.storage,
  );

  return {
    service,
    records,
    receipts,
    create,
    patch,
    owners,
    recordRepository,
    commands,
    isInTransaction: () => inTransaction,
  };
}

function existingRecord(): RecordDetail {
  return {
    id: 'record-1',
    code: 'ANT-0001',
    name: 'Vase',
    unitKind: 'single',
    components: [],
    pieceCount: null,
    categoryIds: [],
    materialIds: [],
    period: null,
    dimensions: {},
    location: { locationId: null, detail: '' },
    acquisition: { receiptAssetIds: [] },
    tags: [],
    description: '',
    collectorJudgment: null,
    recordRevision: 1,
    analysisInputVersion: 1,
    evidenceVersion: 1,
    createdAt: now,
    updatedAt: now,
    mediaIds: [],
    checkIds: [],
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
  };
}

describe('fn:createRecordService', () => {
  it('should create a durable record with default editable fields and replay the same request', async () => {
    const fixture = createFixture();
    const created = await fixture.service.create(
      ownerId,
      'create-1',
      createInput,
    );
    const replay = await fixture.service.create(
      ownerId,
      'create-1',
      createInput,
    );

    expect(created).toMatchObject({
      success: true,
      data: {
        id: 'record-1',
        code: 'ANT-0001',
        unitKind: 'single',
        recordRevision: 1,
        analysisInputVersion: 1,
        evidenceVersion: 1,
        location: { locationId: null, detail: '' },
        acquisition: { receiptAssetIds: [] },
        mediaIds: [],
        checkIds: [],
      },
    });
    expect(replay).toEqual(created);
    expect(fixture.create).toHaveBeenCalledTimes(1);
    expect(fixture.receipts.get('records.create:create-1')).toMatchObject({
      status: 201,
    });
  });

  it('should reject a reused creation key with different fields before writing', async () => {
    const fixture = createFixture();
    await fixture.service.create(ownerId, 'create-1', createInput);
    const result = await fixture.service.create(ownerId, 'create-1', {
      unitKind: 'single',
      name: 'Different',
    });

    expect(result).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(fixture.create).toHaveBeenCalledTimes(1);
  });

  it('should return owned records and query results, with a missing-record result', async () => {
    const fixture = createFixture({ record: existingRecord() });
    expect(await fixture.service.get(ownerId, 'record-1')).toMatchObject({
      success: true,
      data: { name: 'Vase' },
    });
    expect(await fixture.service.get(ownerId, 'absent')).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
    expect(await fixture.service.list(ownerId, { text: 'Vase' })).toEqual({
      success: true,
      data: { items: [], nextCursor: null },
    });
    expect(fixture.recordRepository.query).toHaveBeenCalledWith({
      text: 'Vase',
    });
    expect(fixture.owners).toHaveBeenCalledWith(ownerId);
  });

  it('should sign ready thumbnail targets after the list transaction and preserve page order', async () => {
    const first: RecordSummary = {
      id: 'record-1',
      code: 'ANT-0001',
      name: 'Vase',
      coverThumbnail: null,
      locationLabel: null,
      analysisFreshness: 'unanalyzed',
      pendingCheckCount: 0,
    };
    const second: RecordSummary = {
      ...first,
      id: 'record-2',
      code: 'ANT-0002',
      name: 'Bowl',
    };
    const signRead = vi.fn(async (key: string) => {
      expect(fixture.isInTransaction()).toBe(false);
      expect(key).toBe('owners/collector-1/ready/thumb.webp');

      return { url: 'https://signed.example/thumb', expiresAt: now };
    });
    const fixture = createFixture({
      page: { items: [second, first], nextCursor: 'next-record' },
      thumbnailTargets: [
        {
          recordId: first.id,
          assetOrDerivativeId: 'derivative-1',
          storageKey: 'owners/collector-1/ready/thumb.webp',
        },
      ],
      storage: { signRead },
    });

    const result = await fixture.service.list(ownerId, {
      cursor: 'previous-record',
      limit: 2,
    });

    expect(result).toEqual({
      success: true,
      data: {
        items: [
          second,
          { ...first, coverThumbnail: 'https://signed.example/thumb' },
        ],
        nextCursor: 'next-record',
      },
    });
    expect(fixture.recordRepository.query).toHaveBeenCalledWith({
      cursor: 'previous-record',
      limit: 2,
    });
    expect(fixture.recordRepository.getThumbnailTargets).toHaveBeenCalledWith([
      second.id,
      first.id,
    ]);
    expect(signRead).toHaveBeenCalledTimes(1);
  });

  it('should skip thumbnail lookup for an empty page', async () => {
    const signRead = vi.fn(async () => ({
      url: 'https://signed.example/thumb',
      expiresAt: now,
    }));
    const fixture = createFixture({ storage: { signRead } });

    expect(await fixture.service.list(ownerId, {})).toEqual({
      success: true,
      data: { items: [], nextCursor: null },
    });
    expect(fixture.recordRepository.getThumbnailTargets).not.toHaveBeenCalled();
    expect(signRead).not.toHaveBeenCalled();
  });

  it('should advance analysis input version only when analysis fields change', async () => {
    const fixture = createFixture({ record: existingRecord() });
    const location = {
      expectedRevision: 1,
      fields: { location: { locationId: null, detail: 'Cabinet' } },
    } satisfies RecordPatch;
    const locationResult = await fixture.service.patch(
      ownerId,
      'record-1',
      'patch-1',
      location,
    );
    const contentResult = await fixture.service.patch(
      ownerId,
      'record-1',
      'patch-2',
      {
        expectedRevision: 2,
        fields: { name: 'Blue vase' },
      },
    );

    expect(locationResult).toMatchObject({
      success: true,
      data: { recordRevision: 2, analysisInputVersion: 1 },
    });
    expect(contentResult).toMatchObject({
      success: true,
      data: { recordRevision: 3, analysisInputVersion: 2, name: 'Blue vase' },
    });
    expect(fixture.patch).toHaveBeenCalledTimes(2);
  });

  it('should replay a patch with reordered fields and reject a changed request key', async () => {
    const fixture = createFixture({ record: existingRecord() });
    const input = {
      expectedRevision: 1,
      fields: { name: 'Blue vase', description: 'Glazed' },
    } satisfies RecordPatch;
    const first = await fixture.service.patch(
      ownerId,
      'record-1',
      'patch-1',
      input,
    );
    const replay = await fixture.service.patch(ownerId, 'record-1', 'patch-1', {
      expectedRevision: 1,
      fields: { description: 'Glazed', name: 'Blue vase' },
    });
    const conflict = await fixture.service.patch(
      ownerId,
      'record-1',
      'patch-1',
      {
        expectedRevision: 1,
        fields: { name: 'Other' },
      },
    );

    expect(replay).toEqual(first);
    expect(conflict).toMatchObject({
      success: false,
      error: { code: 'VALIDATION_FAILED' },
    });
    expect(fixture.patch).toHaveBeenCalledTimes(1);
  });

  it('should reject missing records, stale revisions, and unsupported draft adoption', async () => {
    const fixture = createFixture({ record: existingRecord() });
    expect(
      await fixture.service.patch(ownerId, 'absent', 'patch-1', {
        expectedRevision: 1,
        fields: {},
      }),
    ).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(
      await fixture.service.patch(ownerId, 'record-1', 'patch-2', {
        expectedRevision: 2,
        fields: {},
      }),
    ).toMatchObject({ success: false, error: { code: 'REVISION_CONFLICT' } });
    expect(
      await fixture.service.patch(ownerId, 'record-1', 'patch-3', {
        expectedRevision: 1,
        fields: {},
        editDraftId: 'draft-1',
        acceptedProposalIds: [],
      }),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    expect(fixture.patch).not.toHaveBeenCalled();
  });

  it('should translate a removed in-use component and preserve unexpected failures', async () => {
    const fixture = createFixture({
      record: existingRecord(),
      patchError: new ComponentInUseError(),
    });
    const input = {
      expectedRevision: 1,
      fields: { name: 'Changed' },
    } satisfies RecordPatch;
    expect(
      await fixture.service.patch(ownerId, 'record-1', 'patch-1', input),
    ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
    const failure = new Error('storage offline');
    const broken = createFixture({
      record: existingRecord(),
      patchError: failure,
    });
    await expect(
      broken.service.patch(ownerId, 'record-1', 'patch-1', input),
    ).rejects.toBe(failure);
  });

  it('should return a revision conflict when the write loses its compare-and-swap', async () => {
    const fixture = createFixture({
      record: existingRecord(),
      patchResult: null,
    });
    const result = await fixture.service.patch(ownerId, 'record-1', 'patch-1', {
      expectedRevision: 1,
      fields: { name: 'Changed' },
    });
    expect(result).toMatchObject({
      success: false,
      error: { code: 'REVISION_CONFLICT' },
    });
    expect(fixture.commands.insert).not.toHaveBeenCalled();
  });
});
