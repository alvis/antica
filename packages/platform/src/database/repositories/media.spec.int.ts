import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalViews,
  mediaAssets,
  mediaDerivatives,
  recordComponents,
  records,
  sourceIntakes,
  sources,
  sourceVersions,
  uploadParts,
} from '../schema/index.js';
import { createIsolatedDatabase } from '../spec/fixtures/isolated-database.js';
import { createTransactionPort } from '../transaction.js';

import type { UploadRequest, UploadSession } from '@antica/contracts';
import type { CanonicalView } from '@antica/domain';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated PostgreSQL database',
  );
}

const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1] as const;

describe('fn:createMediaRepository', () => {
  it('should resolve a source-version asset after intake promotion', async () => {
    const database = await createIsolatedDatabase();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const assetId = randomUUID();
    try {
      await database.db.insert(sources).values({
        id: sourceId,
        ownerId: database.ownerId,
        kind: 'book',
        title: 'Synthetic catalog',
        authorStatus: 'unknown',
        access: 'uploaded',
      });
      await database.db.insert(sourceVersions).values({
        id: sourceVersionId,
        sourceId,
        ownerId: database.ownerId,
        sourceHash: randomUUID(),
        metadataSnapshot: {},
        capturedAt: '2026-10-13T00:00:00Z',
        status: 'registered',
        textIndexStatus: 'registered',
        imageIndexStatus: 'registered',
      });
      await database.db.insert(mediaAssets).values({
        id: assetId,
        ownerId: database.ownerId,
        sourceVersionId,
        kind: 'photo',
        purpose: 'book_page',
        state: 'ready',
        objectKey: randomUUID(),
        originalFileName: 'page.jpg',
        mimeType: 'image/jpeg',
        byteLength: 10,
        sha256: 'a'.repeat(64),
      });
      const result = await createTransactionPort(database.db).run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: await unit.media.get(assetId),
        }),
      );
      expect(result.data?.owner).toEqual({
        kind: 'source_version',
        sourceVersionId,
      });
    } finally {
      await database.close();
    }
  });
  it('should refuse a canonical view whose derivative belongs to a different original', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const intakeId = randomUUID();
    const originalId = randomUUID();
    const otherOriginalId = randomUUID();
    const derivativeId = randomUUID();
    const viewId = randomUUID();
    try {
      await database.db
        .insert(sourceIntakes)
        .values({ id: intakeId, ownerId: database.ownerId });
      await database.db.insert(mediaAssets).values(
        [originalId, otherOriginalId].map((id) => ({
          id,
          ownerId: database.ownerId,
          sourceIntakeId: intakeId,
          kind: 'photo',
          purpose: 'book_page',
          state: 'ready',
          objectKey: id,
          originalFileName: 'page.jpg',
          mimeType: 'image/jpeg',
          byteLength: 10,
          sha256: 'a'.repeat(64),
        })),
      );
      await database.db.insert(mediaDerivatives).values({
        id: derivativeId,
        originalAssetId: otherOriginalId,
        ownerId: database.ownerId,
        kind: 'canonical',
        objectKey: randomUUID(),
        mimeType: 'image/png',
        byteLength: 10,
        sha256: 'b'.repeat(64),
      });
      await database.db.insert(canonicalViews).values({
        id: viewId,
        originalAssetId: originalId,
        derivativeId,
        width: 20,
        height: 30,
        coordinateSpace: 'image_pixels',
        transformToOriginal: identity,
      });
      const result = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.media.getCanonicalViewSource(viewId),
      }));
      expect(result.data).toBeNull();
    } finally {
      await database.close();
    }
  });
  it('should persist multipart upload parts and component membership for a record', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const recordId = randomUUID();
    const componentId = randomUUID();
    const assetId = randomUUID();
    const request: UploadRequest = {
      requestKey: randomUUID(),
      target: { kind: 'record', recordId },
      kind: 'video',
      purpose: 'object',
      componentIds: [componentId],
      fileName: 'object.mp4',
      mimeType: 'video/mp4',
      byteLength: 10,
      sha256: 'A'.repeat(64),
    };
    const session: UploadSession = {
      assetId,
      expiresAt: '2030-01-01T00:00:00.000Z',
      mode: 'multipart',
      uploadId: randomUUID(),
      parts: [
        {
          partNumber: 1,
          offset: 0,
          byteLength: 10,
          putUrl: 'https://example.test/part',
          headers: {},
        },
      ],
    };
    try {
      await database.db.insert(records).values({
        id: recordId,
        ownerId: database.ownerId,
        code: 'VIDEO',
        unitKind: 'set',
        pieceCount: 2,
      });
      await database.db.insert(recordComponents).values({
        id: componentId,
        recordId,
        ownerId: database.ownerId,
        label: 'Lid',
        ordinal: 1,
      });
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.media.createUpload(request, session);

        return {
          success: true as const,
          data: {
            asset: await unit.media.get(assetId),
            session: await unit.media.getUploadSession(assetId),
            missing: await unit.media.getUploadByRequestKey(
              database.ownerId,
              randomUUID(),
            ),
          },
        };
      });
      expect(saved.data).toMatchObject({
        asset: {
          owner: request.target,
          componentIds: [componentId],
          sha256: 'a'.repeat(64),
        },
        session,
        missing: null,
      });
      expect(
        await database.db
          .select({
            assetId: uploadParts.assetId,
            partNumber: uploadParts.partNumber,
            offset: uploadParts.offset,
            byteLength: uploadParts.byteLength,
          })
          .from(uploadParts),
      ).toEqual([{ assetId, partNumber: 1, offset: 0, byteLength: 10 }]);
    } finally {
      await database.close();
    }
  });
  it('should retain exact video frame coordinates and hide incomplete or foreign frame metadata', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const originalAssetId = randomUUID();
    const intakeId = randomUUID();
    const derivativeId = randomUUID();
    const frame = {
      frameDerivativeId: derivativeId,
      streamIndex: 0,
      pts: '120',
      timeBase: { numerator: 1, denominator: 30 },
      displayTimeMs: 4000,
    };
    const derivative = {
      id: derivativeId,
      originalAssetId,
      parentDerivativeId: null,
      kind: 'frame' as const,
      storageKey: randomUUID(),
      mimeType: 'image/png',
      byteLength: 10,
      sha256: 'b'.repeat(64),
      region: null,
      transformToOriginal: identity,
      frame,
    };
    try {
      await database.db
        .insert(sourceIntakes)
        .values({ id: intakeId, ownerId: database.ownerId });
      await database.db.insert(mediaAssets).values({
        id: originalAssetId,
        ownerId: database.ownerId,
        sourceIntakeId: intakeId,
        kind: 'video',
        purpose: 'object',
        state: 'ready',
        objectKey: randomUUID(),
        originalFileName: 'video.mp4',
        mimeType: 'video/mp4',
        byteLength: 10,
        sha256: 'a'.repeat(64),
        durationMs: '4100.125',
      });
      await expect(
        transaction.run(database.ownerId, async (unit) => {
          await unit.media.addDerivative({
            ...derivative,
            frame: { ...frame, frameDerivativeId: randomUUID() },
          });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const saved = await transaction.run(database.ownerId, async (unit) => {
        await unit.media.addDerivative(derivative);

        return {
          success: true as const,
          data: {
            derivative: await unit.media.getDerivative(derivativeId),
            frame: await unit.media.getFrameByDerivative(derivativeId),
            duration: (await unit.media.get(originalAssetId))?.durationMs,
          },
        };
      });
      expect(saved.data).toEqual({ derivative, frame, duration: 4100.125 });
      const hidden = await transaction.run(randomUUID(), async (unit) => ({
        success: true as const,
        data: await unit.media.getFrameByDerivative(derivativeId),
      }));
      expect(hidden.data).toBeNull();
      const incompleteId = randomUUID();
      await database.db.insert(mediaDerivatives).values({
        id: incompleteId,
        ownerId: database.ownerId,
        originalAssetId,
        kind: 'frame',
        objectKey: randomUUID(),
        mimeType: 'image/png',
        byteLength: 10,
        sha256: 'c'.repeat(64),
      });
      const incomplete = await transaction.run(
        database.ownerId,
        async (unit) => ({
          success: true as const,
          data: await unit.media.getFrameByDerivative(incompleteId),
        }),
      );
      expect(incomplete.data).toBeNull();
    } finally {
      await database.close();
    }
  });
  it('should reject derivatives and views whose original belongs to another collector', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const assetId = randomUUID();
    try {
      await transaction.run(database.ownerId, async (unit) => {
        await unit.media.createUpload(
          {
            requestKey: randomUUID(),
            target: { kind: 'source_intake', intakeKey: randomUUID() },
            kind: 'photo',
            purpose: 'book_page',
            componentIds: [],
            fileName: 'page.jpg',
            mimeType: 'image/jpeg',
            byteLength: 5,
            sha256: 'a'.repeat(64),
          },
          {
            assetId,
            mode: 'single',
            expiresAt: '2030-01-01T00:00:00.000Z',
            putUrl: 'https://example.test/upload',
            headers: {},
          },
        );

        return { success: true as const, data: undefined };
      });
      await expect(
        transaction.run(randomUUID(), async (unit) => {
          await unit.media.addDerivative({
            id: randomUUID(),
            originalAssetId: assetId,
            parentDerivativeId: null,
            kind: 'canonical',
            storageKey: randomUUID(),
            mimeType: 'image/png',
            byteLength: 4,
            sha256: 'b'.repeat(64),
            region: null,
            transformToOriginal: identity,
          });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      await expect(
        transaction.run(randomUUID(), async (unit) => {
          await unit.media.addCanonicalView({
            id: randomUUID(),
            originalAssetId: assetId,
            derivativeId: null,
            width: 20,
            height: 30,
            originalCoordinateSpace: 'image_pixels',
            transformToOriginal: identity,
          });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow();
      const asset = await transaction.run(database.ownerId, async (unit) => ({
        success: true as const,
        data: await unit.media.get(assetId),
      }));
      expect(asset.data?.views).toEqual([]);
    } finally {
      await database.close();
    }
  });
  it('should retain upload, derivative, and canonical-view state across owner-scoped transactions', async () => {
    const database = await createIsolatedDatabase();
    const transaction = createTransactionPort(database.db);
    const ownerId = database.ownerId;
    const otherOwnerId = randomUUID();
    const assetId = randomUUID();
    const request: UploadRequest = {
      requestKey: randomUUID(),
      target: { kind: 'source_intake', intakeKey: randomUUID() },
      kind: 'photo',
      purpose: 'book_page',
      componentIds: [],
      fileName: 'page.jpg',
      mimeType: 'image/jpeg',
      byteLength: 5,
      sha256: 'a'.repeat(64),
    };
    const session: UploadSession = {
      assetId,
      expiresAt: '2026-10-14T00:00:00.000Z',
      mode: 'single',
      putUrl: 'https://example.test/upload',
      headers: {},
    };
    const derivative = {
      id: randomUUID(),
      originalAssetId: assetId,
      parentDerivativeId: null,
      kind: 'canonical' as const,
      storageKey: `canonical/${assetId}`,
      mimeType: 'image/png',
      byteLength: 4,
      sha256: 'b'.repeat(64),
      region: null,
      transformToOriginal: identity,
    };
    const originalView: CanonicalView = {
      id: randomUUID(),
      originalAssetId: assetId,
      derivativeId: null,
      width: 20,
      height: 30,
      originalCoordinateSpace: 'image_pixels',
      transformToOriginal: identity,
    };
    const processedView: CanonicalView = {
      ...originalView,
      id: randomUUID(),
      derivativeId: derivative.id,
    };

    try {
      await transaction.run(ownerId, async (unit) => {
        await unit.media.createUpload(request, session);

        return { success: true as const, data: undefined };
      });
      const pending = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          byRequest: await unit.media.getUploadByRequestKey(
            ownerId,
            request.requestKey,
          ),
          byAsset: await unit.media.getUploadSession(assetId),
          asset: await unit.media.get(assetId),
        },
      }));
      expect(pending.data).toMatchObject({
        byRequest: session,
        byAsset: session,
        asset: {
          id: assetId,
          owner: request.target,
          state: 'awaiting_upload',
          purpose: 'book_page',
          views: [],
        },
      });
      const foreign = await transaction.run(otherOwnerId, async (unit) => ({
        success: true as const,
        data: {
          asset: await unit.media.get(assetId),
          session: await unit.media.getUploadSession(assetId),
          request: await unit.media.getUploadByRequestKey(
            ownerId,
            request.requestKey,
          ),
        },
      }));
      expect(foreign.data).toEqual({
        asset: null,
        session: null,
        request: null,
      });

      await transaction.run(ownerId, async (unit) => {
        await unit.media.complete(assetId, {
          assetId,
          state: 'uploaded',
          processingJobId: null,
        });
        expect(await unit.media.markReadyOnce(assetId, 'uploaded')).toBe(true);
        expect(await unit.media.markReadyOnce(assetId, 'uploaded')).toBe(false);
        await unit.media.addDerivative(derivative);
        await unit.media.addCanonicalView(originalView);
        await unit.media.addCanonicalView(processedView);

        return { success: true as const, data: undefined };
      });
      const ready = await transaction.run(ownerId, async (unit) => ({
        success: true as const,
        data: {
          asset: await unit.media.get(assetId),
          derivative: await unit.media.getDerivative(derivative.id),
          originalView: await unit.media.getCanonicalView(originalView.id),
          processedView: await unit.media.getCanonicalView(processedView.id),
          originalSource: await unit.media.getCanonicalViewSource(
            originalView.id,
          ),
          processedSource: await unit.media.getCanonicalViewSource(
            processedView.id,
          ),
        },
      }));
      expect(ready.data).toMatchObject({
        asset: {
          id: assetId,
          state: 'ready',
          views: [originalView, processedView],
        },
        derivative,
        originalView,
        processedView,
        originalSource: {
          originalAssetId: assetId,
          derivativeId: null,
          storageKey: `originals/${assetId}`,
          mimeType: 'image/jpeg',
        },
        processedSource: {
          originalAssetId: assetId,
          derivativeId: derivative.id,
          storageKey: derivative.storageKey,
          mimeType: derivative.mimeType,
        },
      });
      const hidden = await transaction.run(otherOwnerId, async (unit) => ({
        success: true as const,
        data: {
          derivative: await unit.media.getDerivative(derivative.id),
          view: await unit.media.getCanonicalView(processedView.id),
          source: await unit.media.getCanonicalViewSource(processedView.id),
        },
      }));
      expect(hidden.data).toEqual({
        derivative: null,
        view: null,
        source: null,
      });
      await expect(
        transaction.run(ownerId, async (unit) => {
          await unit.media.complete(assetId, {
            assetId,
            state: 'uploaded',
            processingJobId: null,
          });

          return { success: true as const, data: undefined };
        }),
      ).rejects.toThrow('Media upload is missing or already completed');
    } finally {
      await database.close();
    }
  });
});
