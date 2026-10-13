import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';

import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  createEvidenceService,
  createMediaJobHandler,
  createMediaService,
  createRecordService,
} from '@antica/application/server';

import {
  createLocalMediaStore,
  processImage,
  createDatabase,
  createTransactionPort,
} from '@antica/platform';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}
const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
const ids = { create: randomUUID };

describe('Persistent collection commands', () => {
  it('should retain six photos in one set and retry only an unfinished upload without starting analysis', async () => {
    const database = createDatabase({ url: databaseUrl });
    const root = await mkdtemp(join(tmpdir(), 'antica-set-'));
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    const storage = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'acceptance-media-secret-at-least-32-characters',
    });
    const media = createMediaService(transaction, storage, clock, ids);
    const bytes = Uint8Array.from(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
        'base64',
      ),
    );
    try {
      const created = await records.create(ownerId, randomUUID(), {
        unitKind: 'set',
        name: '青釉瓶一對',
        pieceCount: 2,
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }
      const sessions = await Promise.all(
        Array.from({ length: 6 }, async (_, index) =>
          media.start(ownerId, {
            requestKey: randomUUID(),
            target: { kind: 'record', recordId: created.data.id },
            kind: 'photo',
            purpose: 'object',
            componentIds: [],
            fileName: `angle-${index}.png`,
            mimeType: 'image/png',
            byteLength: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
          }),
        ),
      );
      const uploads = sessions.map((session) => {
        if (!session.success || session.data.mode !== 'single') {
          throw new Error('Expected development single upload');
        }

        return session.data;
      });
      for (const upload of uploads.slice(0, 5)) {
        await storage.acceptUploadToken(
          new URL(upload.putUrl).pathname.split('/').at(-1)!,
          bytes,
          'image/png',
        );
        const key = randomUUID();
        const completed = await media.complete(ownerId, upload.assetId, key);
        expect(completed).toMatchObject({
          success: true,
          data: { assetId: upload.assetId, state: 'uploaded' },
        });
        expect(await media.complete(ownerId, upload.assetId, key)).toEqual(
          completed,
        );
      }
      const unfinished = uploads[5]!;
      expect(
        await media.complete(ownerId, unfinished.assetId, randomUUID()),
      ).toMatchObject({ success: false, error: { code: 'UPLOAD_INCOMPLETE' } });
      expect(await media.get(randomUUID(), unfinished.assetId)).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
      const beforeRetry = await records.get(ownerId, created.data.id);
      expect(beforeRetry).toMatchObject({
        success: true,
        data: {
          unitKind: 'set',
          mediaIds: expect.arrayContaining(
            uploads.map((upload) => upload.assetId),
          ),
          latestRunId: null,
          analysisInputVersion: 1,
          evidenceVersion: 1,
        },
      });
      await storage.acceptUploadToken(
        new URL(unfinished.putUrl).pathname.split('/').at(-1)!,
        bytes,
        'image/png',
      );
      expect(
        await media.complete(ownerId, unfinished.assetId, randomUUID()),
      ).toMatchObject({ success: true, data: { state: 'uploaded' } });
      const events = await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.outbox.pending(100),
      }));
      expect(events.data.map((event) => event.name)).toEqual(
        Array.from({ length: 6 }, () => 'antica.media.uploaded'),
      );
      expect(await records.list(ownerId, {})).toMatchObject({
        success: true,
        data: { items: [{ id: created.data.id }], nextCursor: null },
      });
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('should reopen one paired record with separate locations, unknown fields, and an idempotent creation receipt', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const key = randomUUID();
    const components = [
      { id: randomUUID(), label: '左瓶' },
      { id: randomUUID(), label: '右瓶' },
    ];
    const service = createRecordService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
      const created = await service.create(ownerId, key, {
        unitKind: 'set',
        name: '青釉瓶一對',
        components,
        pieceCount: 2,
        location: { locationId: null, detail: '第二層右上角' },
      });
      expect(created.success).toBe(true);
      if (!created.success) {
        throw new Error('Record fixture failed');
      }
      const replayed = await service.create(ownerId, key, {
        name: '青釉瓶一對',
        pieceCount: 2,
        components,
        unitKind: 'set',
        location: { detail: '第二層右上角', locationId: null },
      });
      expect(replayed).toEqual(created);
      const reused = await service.create(ownerId, key, {
        unitKind: 'single',
        name: 'Different object',
      });
      expect(reused).toMatchObject({
        success: false,
        error: { code: 'VALIDATION_FAILED' },
      });
      await database.close();

      const reopened = createDatabase({ url: databaseUrl });
      try {
        const records = createRecordService(
          createTransactionPort(reopened.db),
          clock,
          ids,
        );
        const detail = await records.get(ownerId, created.data.id);
        expect(detail).toMatchObject({
          success: true,
          data: {
            id: created.data.id,
            unitKind: 'set',
            components,
            pieceCount: 2,
            materialIds: [],
            period: null,
            location: { locationId: null, detail: '第二層右上角' },
            latestRunId: null,
            mediaIds: [],
          },
        });
        const page = await records.list(ownerId, {});
        expect(page).toMatchObject({
          success: true,
          data: { items: [{ id: created.data.id }], nextCursor: null },
        });
        expect(await records.get(randomUUID(), created.data.id)).toMatchObject({
          success: false,
          error: { code: 'NOT_FOUND' },
        });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should preserve the newer record when a stale writer submits an update', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createRecordService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
      const created = await service.create(ownerId, randomUUID(), {
        unitKind: 'single',
        name: 'Before',
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }

      const updated = await service.patch(
        ownerId,
        created.data.id,
        randomUUID(),
        { expectedRevision: 1, fields: { name: 'Collector correction' } },
      );
      const stale = await service.patch(
        ownerId,
        created.data.id,
        randomUUID(),
        { expectedRevision: 1, fields: { name: 'Stale AI suggestion' } },
      );
      const current = await service.get(ownerId, created.data.id);

      expect(updated).toMatchObject({
        success: true,
        data: { recordRevision: 2, analysisInputVersion: 2 },
      });
      expect(stale).toMatchObject({
        success: false,
        error: { code: 'REVISION_CONFLICT' },
      });
      expect(current).toMatchObject({
        success: true,
        data: {
          name: 'Collector correction',
          recordRevision: 2,
          latestRunId: null,
        },
      });
    } finally {
      await database.close();
    }
  });

  it('should allow only one concurrent writer to consume a record revision', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const service = createRecordService(
      createTransactionPort(database.db),
      clock,
      ids,
    );
    try {
      const created = await service.create(ownerId, randomUUID(), {
        unitKind: 'single',
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }

      const results = await Promise.all([
        service.patch(ownerId, created.data.id, randomUUID(), {
          expectedRevision: 1,
          fields: { description: 'First editor' },
        }),
        service.patch(ownerId, created.data.id, randomUUID(), {
          expectedRevision: 1,
          fields: { description: 'Second editor' },
        }),
      ]);

      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success)).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({ code: 'REVISION_CONFLICT' }),
        }),
      ]);
      expect(await service.get(ownerId, created.data.id)).toMatchObject({
        success: true,
        data: { recordRevision: 2, analysisInputVersion: 2 },
      });
    } finally {
      await database.close();
    }
  });

  it('should reopen a standalone tactile observation without starting analysis or inventing media', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    const evidence = createEvidenceService(transaction, clock, ids);
    try {
      const created = await records.create(ownerId, randomUUID(), {
        unitKind: 'single',
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }
      const input = {
        recordId: created.data.id,
        componentIds: [],
        channel: 'typed' as const,
        text: '摸落去有啲粗糙；手感，並非照片判斷。',
        evidenceAnchorIds: [],
        checkIds: [],
        observedAt: clock.now(),
        voice: null,
        editDraftId: null,
        supersedesObservationId: null,
      };
      const key = randomUUID();
      const saved = await evidence.addObservation(ownerId, key, input);
      const replayed = await evidence.addObservation(ownerId, key, input);
      expect(replayed).toEqual(saved);
      await database.close();

      const reopened = createDatabase({ url: databaseUrl });
      try {
        const nextTransaction = createTransactionPort(reopened.db);
        const read = await createEvidenceService(
          nextTransaction,
          clock,
          ids,
        ).observations(ownerId, created.data.id);
        expect(read).toMatchObject({
          success: true,
          data: { items: [expect.objectContaining(input)], nextCursor: null },
        });
        expect(
          await createRecordService(nextTransaction, clock, ids).get(
            ownerId,
            created.data.id,
          ),
        ).toMatchObject({
          success: true,
          data: {
            recordRevision: 2,
            analysisInputVersion: 2,
            evidenceVersion: 1,
            mediaIds: [],
            checkIds: [],
            latestRunId: null,
          },
        });
        expect(
          await nextTransaction.run(ownerId, async (unit) => ({
            success: true,
            data: await unit.outbox.pending(100),
          })),
        ).toEqual({ success: true, data: [] });
      } finally {
        await reopened.close();
      }
    } finally {
      await database.close();
    }
  });

  it('should roll back partial writes when a command returns a validation failure', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    try {
      const result = await transaction.run(ownerId, async (unit) => {
        await unit.locations.create({
          id: randomUUID(),
          label: 'Must not survive',
        });

        return {
          success: false,
          error: {
            code: 'EVIDENCE_INVALID',
            message: 'Foreign reference rejected',
            retryable: false,
          },
        };
      });
      const locations = await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.locations.query(),
      }));

      expect(result).toMatchObject({
        success: false,
        error: { code: 'EVIDENCE_INVALID' },
      });
      expect(locations).toEqual({ success: true, data: [] });
    } finally {
      await database.close();
    }
  });
});

describe('Persistent component references', () => {
  it('should preserve attached media, measurement, and anchor references when components are relabeled and reordered', async () => {
    const database = createDatabase({ url: databaseUrl });
    const root = await mkdtemp(join(tmpdir(), 'antica-components-'));
    const ownerId = randomUUID();
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, ids);
    const evidence = createEvidenceService(transaction, clock, ids);
    const store = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'acceptance-components-secret-at-least-32-characters',
    });
    const media = createMediaService(transaction, store, clock, ids);
    const handler = createMediaJobHandler(
      transaction,
      { processImage: async (input) => processImage({ ...input, store }) },
      clock,
      ids,
    );
    const first = { id: randomUUID(), label: 'Left vase' };
    const second = { id: randomUUID(), label: 'Right vase' };
    const dimensions = {
      height: { value: 12, unit: 'cm' as const, componentId: first.id },
    };
    try {
      const created = await records.create(ownerId, randomUUID(), {
        unitKind: 'set',
        components: [first, second],
        dimensions,
      });
      if (!created.success) {
        throw new Error('Record fixture failed');
      }
      const bytes = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGNIn90ORww4OQBl8BJtnUF/dAAAAABJRU5ErkJggg==',
        'base64',
      );
      const upload = await media.start(ownerId, {
        requestKey: randomUUID(),
        target: { kind: 'record', recordId: created.data.id },
        kind: 'photo',
        purpose: 'object',
        componentIds: [first.id],
        fileName: 'left.png',
        mimeType: 'image/png',
        byteLength: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
      if (!upload.success || upload.data.mode !== 'single') {
        throw new Error('Upload fixture failed');
      }
      await store.acceptUploadToken(
        new URL(upload.data.putUrl).pathname.split('/').at(-1)!,
        bytes,
        'image/png',
      );
      const completed = await media.complete(
        ownerId,
        upload.data.assetId,
        randomUUID(),
      );
      if (!completed.success || !completed.data.processingJobId) {
        throw new Error('Completion fixture failed');
      }
      expect(
        await handler(ownerId, completed.data.processingJobId),
      ).toMatchObject({ success: true });
      const detail = await media.get(ownerId, upload.data.assetId);
      if (!detail.success || !detail.data.asset.views[0]) {
        throw new Error('Prepared photo missing');
      }
      const anchor = await evidence.createAnchor(ownerId, {
        requestKey: randomUUID(),
        mode: 'create',
        evidence: {
          kind: 'image',
          recordId: created.data.id,
          componentIds: [first.id],
          originalAssetId: upload.data.assetId,
          canonicalViewId: detail.data.asset.views[0].id,
          scope: { kind: 'whole' },
        },
      });
      if (!anchor.success) {
        throw new Error('Anchor fixture failed');
      }
      const before = await records.get(ownerId, created.data.id);
      if (!before.success) {
        throw new Error('Record missing');
      }
      const components = [second, { ...first, label: 'Relabeled left vase' }];
      const patched = await records.patch(
        ownerId,
        created.data.id,
        randomUUID(),
        {
          expectedRevision: before.data.recordRevision,
          fields: { components },
        },
      );
      expect(patched).toMatchObject({ success: true });
      const after = await records.get(ownerId, created.data.id);
      expect(after).toMatchObject({
        success: true,
        data: {
          components,
          dimensions,
          mediaIds: [upload.data.assetId],
          recordRevision: before.data.recordRevision + 1,
        },
      });
      expect(await media.get(ownerId, upload.data.assetId)).toMatchObject({
        success: true,
        data: {
          asset: { componentIds: [first.id] },
          anchors: [
            expect.objectContaining({
              id: anchor.data.id,
              componentIds: [first.id],
            }),
          ],
        },
      });
      expect(
        await records.patch(ownerId, created.data.id, randomUUID(), {
          expectedRevision: before.data.recordRevision + 1,
          fields: { components: [second] },
        }),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      expect(await records.get(ownerId, created.data.id)).toEqual(after);
      expect(await media.get(ownerId, upload.data.assetId)).toMatchObject({
        success: true,
        data: {
          asset: { componentIds: [first.id] },
          anchors: [
            expect.objectContaining({
              id: anchor.data.id,
              componentIds: [first.id],
            }),
          ],
        },
      });
    } finally {
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
