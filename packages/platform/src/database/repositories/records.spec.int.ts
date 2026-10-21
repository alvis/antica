import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { ComponentInUseError } from '@antica/application/ports';

import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';
import { createTransactionPort } from '../transaction.js';

import { createLocationRepository, createRecordRepository } from './records.js';

import { recordFieldsSchema, recordPatchSchema } from '@antica/contracts';

import type { RecordDetail } from '@antica/contracts';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated PostgreSQL database',
  );
}

const now = '2026-10-13T00:00:00.000Z';
const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

describe('fn:createRecordRepository', { timeout: 30_000 }, () => {
  it('should reject a suppressed location insert instead of returning an absent conflict', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db
        .$executeRaw`create function suppress_location_insert() returns trigger language plpgsql as $$ begin return null; end $$`;
      await database.db
        .$executeRaw`create trigger suppress_location_insert before insert on locations for each row execute function suppress_location_insert()`;

      await expect(
        database.db.$transaction(async (tx) =>
          createLocationRepository(tx, database.ownerId).create({
            id: randomUUID(),
            label: 'Shelf',
          }),
        ),
      ).rejects.toThrow('Conflicting location could not be resolved');
      expect(await database.db.locations.count()).toBe(0);
    } finally {
      await database.close();
    }
  });

  it('should patch an owned location and treat a missing latest run as unanalyzed', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const id = randomUUID();
        const location = { id: randomUUID(), label: 'New shelf' };
        await createLocationRepository(tx, database.ownerId).create(location);
        await repository.create(
          recordDetail(id, await repository.allocateCode()),
        );

        expect(
          await repository.patch(
            id,
            {
              expectedRevision: 1,
              fields: {
                location: { locationId: location.id, detail: 'Upper' },
              },
            },
            { recordRevision: 2, analysisInputVersion: 1, evidenceVersion: 1 },
          ),
        ).toMatchObject({
          location: { locationId: location.id, detail: 'Upper' },
        });
        await tx.records.update({
          where: { id },
          data: { latestRunId: randomUUID() },
        });

        expect(await repository.get(id)).toMatchObject({
          analysisFreshness: 'unanalyzed',
        });
        expect((await repository.query({})).items).toEqual([
          expect.objectContaining({
            id,
            locationLabel: location.label,
            analysisFreshness: 'unanalyzed',
          }),
        ]);
      });
    } finally {
      await database.close();
    }
  });

  it('should propagate a database cancellation and roll back a component removal', async () => {
    const database = await createIsolatedDatabase();
    const id = randomUUID();
    const component = { id: randomUUID(), label: 'Lid' };
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        await repository.create({
          ...recordDetail(id, await repository.allocateCode()),
          unitKind: 'set',
          components: [component],
        });
      });
      await database.db
        .$executeRaw`create function delay_component_removal() returns trigger language plpgsql as $$ begin perform pg_sleep(1); return old; end $$`;
      await database.db
        .$executeRaw`create trigger delay_component_removal before delete on record_components for each row execute function delay_component_removal()`;

      await expect(
        database.db.$transaction(async (tx) => {
          await tx.$executeRaw`set local statement_timeout = '250ms'`;

          return createRecordRepository(tx, database.ownerId).patch(
            id,
            { expectedRevision: 1, fields: { components: [] } },
            { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
          );
        }),
      ).rejects.toMatchObject({
        meta: { driverAdapterError: { cause: { originalCode: '57014' } } },
      });
      await database.db.$transaction(async (tx) => {
        expect(
          await createRecordRepository(tx, database.ownerId).get(id),
        ).toMatchObject({ recordRevision: 1, components: [component] });
      });
    } finally {
      await database.close();
    }
  });
  it('should read nullable persisted metadata without exposing another owners location label', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const locationId = randomUUID();
        await createLocationRepository(tx, randomUUID()).create({
          id: locationId,
          label: 'Private cabinet',
        });
        const id = randomUUID();
        await tx.records.createMany({
          data: {
            id,
            ownerId: database.ownerId,
            code: 'AC-000001',
            unitKind: 'single',
            periodStatus: 'unconfirmed',
            locationId,
          },
        });
        await tx.recordMeasurements.createMany({
          data: { recordId: id, kind: 'height', value: '10', unit: 'cm' },
        });
        const repository = createRecordRepository(tx, database.ownerId);
        expect(await repository.get(id)).toMatchObject({
          period: { label: '', status: 'unconfirmed' },
          dimensions: {
            height: { value: 10, unit: 'cm', componentId: undefined },
          },
          acquisition: { acquiredOn: undefined, receiptAssetIds: [] },
        });
        expect((await repository.query({})).items).toEqual([
          expect.objectContaining({ id, locationLabel: null }),
        ]);
      });
    } finally {
      await database.close();
    }
  });
  it('should clear only a seat height through a serialized PATCH and preserve overall height and surface', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const id = randomUUID();
        await repository.create({
          ...recordDetail(id, await repository.allocateCode()),
          surface: '冰裂紋開片，釉面溫潤',
          dimensions: {
            height: { value: 102, unit: 'cm' },
            seatHeight: { value: 51, unit: 'cm' },
          },
        });
        const patch = recordPatchSchema.parse(
          JSON.parse(
            JSON.stringify({
              expectedRevision: 1,
              fields: { dimensions: { seatHeight: null } },
            }),
          ),
        );
        const changed = await repository.patch(id, patch, {
          recordRevision: 2,
          analysisInputVersion: 2,
          evidenceVersion: 1,
        });
        expect(changed?.dimensions).toEqual({
          height: { value: 102, unit: 'cm' },
        });
        expect(changed?.surface).toBe('冰裂紋開片，釉面溫潤');
      });
    } finally {
      await database.close();
    }
  });

  it('should keep a condition and a seat height, and clear every measurement an adopted size set leaves out', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const id = randomUUID();
        await repository.create({
          ...recordDetail(id, await repository.allocateCode()),
          condition: '椅面藤屜已換',
          dimensions: {
            height: { value: 102, unit: 'cm' },
            seatHeight: { value: 51, unit: 'cm' },
          },
        });

        expect(await repository.get(id)).toMatchObject({
          condition: '椅面藤屜已換',
          dimensions: {
            height: { value: 102, unit: 'cm' },
            seatHeight: { value: 51, unit: 'cm' },
          },
        });

        // an adopted size suggestion names every measurement, as adoption writes it through the schema
        const fields = recordFieldsSchema.partial().parse({
          dimensions: {
            height: undefined,
            width: undefined,
            depth: undefined,
            diameter: { value: 21.5, unit: 'cm' },
            seatHeight: undefined,
            weight: undefined,
          },
        });
        const patched = await repository.patch(
          id,
          { expectedRevision: 1, fields },
          { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
        );

        expect(patched?.condition).toBe('椅面藤屜已換');
        // toEqual treats a key read back as undefined as absent, so this asserts every other kind is gone
        expect(patched?.dimensions).toEqual({
          diameter: { value: 21.5, unit: 'cm' },
        });
      });
    } finally {
      await database.close();
    }
  });

  it('should preserve a component still used by a measurement when removal rolls back', async () => {
    const database = await createIsolatedDatabase();
    const id = randomUUID();
    const component = { id: randomUUID(), label: 'Lid' };
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        await repository.create({
          ...recordDetail(id, await repository.allocateCode()),
          unitKind: 'set',
          components: [component],
          dimensions: {
            height: { value: 3, unit: 'cm', componentId: component.id },
          },
        });
      });
      await expect(
        database.db.$transaction(async (tx) =>
          createRecordRepository(tx, database.ownerId).patch(
            id,
            { expectedRevision: 1, fields: { components: [] } },
            { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
          ),
        ),
      ).rejects.toBeInstanceOf(ComponentInUseError);
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        expect(await repository.get(id)).toMatchObject({
          recordRevision: 1,
          components: [component],
        });
        const changed = await repository.patch(
          id,
          { expectedRevision: 1, fields: { name: 'Covered jar' } },
          { recordRevision: 2, analysisInputVersion: 1, evidenceVersion: 1 },
        );
        expect(changed).toMatchObject({
          name: 'Covered jar',
          components: [component],
          dimensions: {
            height: { value: 3, unit: 'cm', componentId: component.id },
          },
        });
      });
    } finally {
      await database.close();
    }
  });
  it('should reconcile components and nullable metadata while rejecting stale or foreign revisions', async () => {
    const database = await createIsolatedDatabase();
    const id = randomUUID();
    const first = { id: randomUUID(), label: 'Cup' };
    const second = { id: randomUUID(), label: 'Saucer' };
    const categoryId = randomUUID();
    const materialId = randomUUID();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const detail: RecordDetail = {
          ...recordDetail(id, await repository.allocateCode()),
          unitKind: 'set',
          components: [first, second],
          pieceCount: 2,
          categoryIds: [categoryId],
          materialIds: [materialId],
          tags: ['porcelain'],
          period: {
            label: 'Qing',
            fromYear: 1800,
            toYear: 1900,
            status: 'collectorClaim',
          },
          dimensions: {
            height: { value: 12, unit: 'cm', componentId: first.id },
            weight: { value: 250, unit: 'g' },
          },
          acquisition: {
            acquiredOn: '2026-10-01',
            seller: 'Gallery',
            method: 'purchase',
            amount: '25.00',
            currency: 'GBP',
            provenanceNote: 'Estate',
            receiptAssetIds: [],
          },
        };
        await repository.create(detail);
        expect(await repository.get(id)).toMatchObject({
          components: [first, second],
          period: detail.period,
          dimensions: detail.dimensions,
          acquisition: detail.acquisition,
        });
        const receiptId = randomUUID();
        await tx.mediaAssets.createMany({
          data: {
            id: receiptId,
            ownerId: database.ownerId,
            recordId: id,
            kind: 'photo',
            purpose: 'receipt',
            state: 'ready',
            objectKey: `receipts/${receiptId}`,
            originalFileName: 'receipt.jpg',
            mimeType: 'image/jpeg',
            byteLength: 3,
            sha256: 'a'.repeat(64),
          },
        });

        const changed = await repository.patch(
          id,
          {
            expectedRevision: 1,
            fields: {
              acquisition: {
                ...detail.acquisition,
                receiptAssetIds: [receiptId],
              },
              components: [second, { ...first, label: 'Teacup' }],
              period: { label: 'Unconfirmed', status: 'unconfirmed' },
              dimensions: {
                height: undefined,
                weight: { value: 0.25, unit: 'kg', componentId: first.id },
              },
            },
          },
          { recordRevision: 2, analysisInputVersion: 2, evidenceVersion: 1 },
        );
        expect(changed).toMatchObject({
          acquisition: { receiptAssetIds: [receiptId] },
          mediaIds: [receiptId],
          components: [second, { ...first, label: 'Teacup' }],
          period: { label: 'Unconfirmed', status: 'unconfirmed' },
          dimensions: {
            height: undefined,
            weight: { value: 0.25, unit: 'kg', componentId: first.id },
          },
        });
        expect(
          await repository.patch(
            id,
            { expectedRevision: 1, fields: { name: 'Stale' } },
            { recordRevision: 3, analysisInputVersion: 3, evidenceVersion: 3 },
          ),
        ).toBeNull();
        expect(
          await createRecordRepository(tx, randomUUID()).get(id),
        ).toBeNull();
        expect(
          await createRecordRepository(tx, randomUUID()).patch(
            id,
            { expectedRevision: 2, fields: { name: 'Foreign' } },
            { recordRevision: 3, analysisInputVersion: 3, evidenceVersion: 3 },
          ),
        ).toBeNull();
        const cleared = await repository.patch(
          id,
          {
            expectedRevision: 2,
            fields: {
              components: [second],
              period: null,
              dimensions: { weight: undefined },
              categoryIds: [],
              materialIds: [],
              tags: [],
              acquisition: { receiptAssetIds: [] },
            },
          },
          { recordRevision: 3, analysisInputVersion: 3, evidenceVersion: 1 },
        );
        expect(cleared).toMatchObject({
          components: [second],
          period: null,
          dimensions: { weight: undefined },
          categoryIds: [],
          materialIds: [],
          tags: [],
          acquisition: {
            seller: undefined,
            amount: undefined,
            receiptAssetIds: [],
          },
        });
        expect(
          await repository.bumpVersions(id, 2, {
            analysisInput: true,
            evidence: true,
          }),
        ).toBeNull();
        expect(
          await repository.bumpVersions(id, 3, {
            analysisInput: false,
            evidence: false,
          }),
        ).toEqual({
          recordRevision: 4,
          analysisInputVersion: 3,
          evidenceVersion: 1,
        });
        expect(
          await repository.bumpVersions(id, 4, {
            analysisInput: true,
            evidence: true,
          }),
        ).toEqual({
          recordRevision: 5,
          analysisInputVersion: 4,
          evidenceVersion: 2,
        });
      });
    } finally {
      await database.close();
    }
  });

  it('should page equal names and null names without omissions and reject a cursor from another query', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const ids = Array.from({ length: 5 }, () => randomUUID()).sort();
        for (const [index, id] of ids.entries()) {
          await repository.create({
            ...recordDetail(id, await repository.allocateCode()),
            name: index < 3 ? 'Cup' : null,
          });
        }
        for (const sort of ['name', 'code', 'updated'] as const) {
          const found: string[] = [];
          let cursor: string | null = null;
          do {
            const page = await repository.query({
              sort,
              limit: 1,
              cursor: cursor ?? undefined,
            });
            found.push(...page.items.map((item) => item.id));
            cursor = page.nextCursor;
          } while (cursor);
          expect(found).toEqual(sort === 'updated' ? [...ids].reverse() : ids);
        }
        const first = await repository.query({ sort: 'name', limit: 1 });
        await expect(
          repository.query({ sort: 'code', cursor: first.nextCursor! }),
        ).rejects.toThrow();
        const malformed = Buffer.from(
          JSON.stringify({ signature: '', sort: 'name', id: 12 }),
        ).toString('base64url');
        await expect(
          repository.query({ sort: 'name', cursor: malformed }),
        ).rejects.toThrow();
        expect((await repository.query({ text: 'missing' })).items).toEqual([]);
      });
    } finally {
      await database.close();
    }
  });

  it('should combine category material tag location freshness and pending-check filters for the owner', async () => {
    const database = await createIsolatedDatabase();
    try {
      await database.db.$transaction(async (tx) => {
        const repository = createRecordRepository(tx, database.ownerId);
        const locations = createLocationRepository(tx, database.ownerId);
        const location = { id: randomUUID(), label: ' Cabinet ' };
        await locations.create(location);
        expect(await locations.findByLabel('CABINET')).toEqual(location);
        expect(await locations.findByLabel('missing')).toBeNull();
        expect(await locations.query()).toEqual([location]);
        expect(
          await createLocationRepository(tx, randomUUID()).query(),
        ).toEqual([]);
        const id = randomUUID();
        const categoryId = randomUUID();
        const materialId = randomUUID();
        await repository.create({
          ...recordDetail(id, await repository.allocateCode()),
          name: 'Porcelain cup',
          categoryIds: [categoryId],
          materialIds: [materialId],
          tags: ['blue'],
          location: { locationId: location.id, detail: 'Shelf 1' },
        });
        const otherId = randomUUID();
        await repository.create(
          recordDetail(otherId, await repository.allocateCode()),
        );
        await tx.recordChecks.createMany({
          data: {
            id: randomUUID(),
            ownerId: database.ownerId,
            recordId: id,
            methodId: randomUUID(),
            methodVersionId: randomUUID(),
            scopeKey: 'whole',
            progress: 'not_started',
          },
        });
        const page = await repository.query({
          text: 'porcelain',
          categoryIds: [categoryId],
          materialIds: [materialId],
          tags: ['blue'],
          locationId: location.id,
          hasPendingChecks: true,
          freshness: 'unanalyzed',
        });
        expect(page.items).toEqual([
          expect.objectContaining({
            id,
            locationLabel: location.label,
            pendingCheckCount: 1,
            analysisFreshness: 'unanalyzed',
          }),
        ]);
        expect(
          (
            await repository.query({
              locationId: null,
              hasPendingChecks: false,
            })
          ).items.map((item) => item.id),
        ).toEqual([otherId]);
        const jobId = randomUUID();
        const snapshotId = randomUUID();
        const runId = randomUUID();
        await tx.jobs.createMany({
          data: {
            id: jobId,
            ownerId: database.ownerId,
            kind: 'analysis',
            resourceId: id,
            state: 'succeeded',
            stage: 'complete',
          },
        });
        await tx.analysisSnapshots.createMany({
          data: {
            id: snapshotId,
            ownerId: database.ownerId,
            recordId: id,
            recordRevision: 1,
            analysisInputVersion: 1,
            evidenceVersion: 1,
            content: {},
            contentHash: randomUUID(),
          },
        });
        await tx.analysisRuns.createMany({
          data: {
            id: runId,
            ownerId: database.ownerId,
            recordId: id,
            jobId,
            snapshotId,
            status: 'completed',
            modelSelection: {},
            profileVersion: '1',
            promptVersion: '1',
            schemaVersion: '1',
          },
        });
        await tx.records.updateMany({
          data: { latestRunId: runId, analysisInputVersion: 2 },
          where: { id },
        });
        expect(await repository.get(id)).toMatchObject({
          analysisFreshness: 'outdated',
        });
        expect(
          (await repository.query({ freshness: 'outdated' })).items.map(
            (item) => item.id,
          ),
        ).toEqual([id]);
        expect(
          (await repository.query({ freshness: 'unanalyzed' })).items.map(
            (item) => item.id,
          ),
        ).toEqual([otherId]);
      });
    } finally {
      await database.close();
    }
  });
  it('should choose one deterministic ready object-photo thumbnail per owned record', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const ownerId = randomUUID();
    const otherOwnerId = randomUUID();

    try {
      const firstRecordId = randomUUID();
      const foreignRecordId = randomUUID();
      await transaction.run(ownerId, async (unit) => {
        await unit.records.create(
          recordDetail(firstRecordId, await unit.records.allocateCode()),
        );

        return { success: true as const, data: undefined };
      });
      await transaction.run(otherOwnerId, async (unit) => {
        await unit.records.create(
          recordDetail(foreignRecordId, await unit.records.allocateCode()),
        );

        return { success: true as const, data: undefined };
      });
      const photoIds = [randomUUID(), randomUUID()].sort();
      const foreignPhotoId = randomUUID();
      const thumbnails = new Map<string, { id: string; storageKey: string }>();
      await transaction.run(ownerId, async (unit) => {
        for (const assetId of photoIds) {
          const requestKey = randomUUID();
          await unit.media.createUpload(
            {
              requestKey,
              target: { kind: 'record', recordId: firstRecordId },
              kind: 'photo',
              purpose: 'object',
              componentIds: [],
              fileName: 'collection.jpg',
              mimeType: 'image/jpeg',
              byteLength: 5,
              sha256: 'a'.repeat(64),
            },
            {
              assetId,
              expiresAt: '2026-10-14T00:00:00.000Z',
              mode: 'single',
              putUrl: 'https://example.test/upload',
              headers: {},
            },
          );
          await unit.media.complete(assetId, {
            assetId,
            state: 'uploaded',
            processingJobId: null,
          });
          expect(await unit.media.markReadyOnce(assetId, 'uploaded')).toBe(
            true,
          );
          const thumbnail = {
            id: randomUUID(),
            storageKey: `thumbnails/${assetId}`,
          };
          thumbnails.set(assetId, thumbnail);
          await unit.media.addDerivative({
            id: thumbnail.id,
            originalAssetId: assetId,
            parentDerivativeId: null,
            kind: 'thumbnail',
            storageKey: thumbnail.storageKey,
            mimeType: 'image/jpeg',
            byteLength: 3,
            sha256: 'b'.repeat(64),
            region: null,
            transformToOriginal: identity,
          });
        }

        return { success: true as const, data: undefined };
      });
      await transaction.run(otherOwnerId, async (unit) => {
        await unit.media.createUpload(
          {
            requestKey: randomUUID(),
            target: { kind: 'record', recordId: foreignRecordId },
            kind: 'photo',
            purpose: 'object',
            componentIds: [],
            fileName: 'foreign.jpg',
            mimeType: 'image/jpeg',
            byteLength: 5,
            sha256: 'c'.repeat(64),
          },
          {
            assetId: foreignPhotoId,
            expiresAt: '2026-10-14T00:00:00.000Z',
            mode: 'single',
            putUrl: 'https://example.test/upload',
            headers: {},
          },
        );
        await unit.media.complete(foreignPhotoId, {
          assetId: foreignPhotoId,
          state: 'uploaded',
          processingJobId: null,
        });
        expect(await unit.media.markReadyOnce(foreignPhotoId, 'uploaded')).toBe(
          true,
        );
        await unit.media.addDerivative({
          id: randomUUID(),
          originalAssetId: foreignPhotoId,
          parentDerivativeId: null,
          kind: 'thumbnail',
          storageKey: `thumbnails/${foreignPhotoId}`,
          mimeType: 'image/jpeg',
          byteLength: 3,
          sha256: 'd'.repeat(64),
          region: null,
          transformToOriginal: identity,
        });

        return { success: true as const, data: undefined };
      });

      const sourceIntakeId = randomUUID();
      await database.db.sourceIntakes.createMany({
        data: { id: sourceIntakeId, ownerId },
      });
      await database.db.mediaAssets.createMany({
        data: {
          id: sourceIntakeId,
          ownerId,
          recordId: null,
          sourceIntakeId,
          kind: 'photo',
          purpose: 'source_original',
          state: 'ready',
          objectKey: `source-intake/${sourceIntakeId}`,
          originalFileName: 'source.jpg',
          mimeType: 'image/jpeg',
          byteLength: 3,
          sha256: 'e'.repeat(64),
        },
      });
      await database.db.mediaDerivatives.createMany({
        data: {
          id: randomUUID(),
          ownerId,
          originalAssetId: sourceIntakeId,
          kind: 'thumbnail',
          objectKey: `source-thumbnails/${sourceIntakeId}`,
          mimeType: 'image/jpeg',
          byteLength: 3,
          sha256: 'f'.repeat(64),
        },
      });

      const selected = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          empty: await unit.records.getThumbnailTargets([]),
          mixed: await unit.records.getThumbnailTargets([
            firstRecordId,
            foreignRecordId,
          ]),
        },
      }));
      expect(selected.data).toEqual({
        empty: [],
        mixed: [
          {
            recordId: firstRecordId,
            assetOrDerivativeId: thumbnails.get(photoIds[0]!)?.id,
            storageKey: thumbnails.get(photoIds[0]!)?.storageKey,
          },
        ],
      });
      const foreignView = await transaction.run(otherOwnerId, async (unit) => ({
        success: true as const,
        data: await unit.records.getThumbnailTargets([firstRecordId]),
      }));
      expect(foreignView.data).toEqual([]);
    } finally {
      await database.close();
    }
  });
});

function recordDetail(id: string, code: string): RecordDetail {
  return {
    id,
    code,
    name: null,
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
    condition: null,
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
