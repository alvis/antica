import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  createMediaService,
  createRecordService,
} from '@antica/application/server';
import { createDatabase, createTransactionPort } from '@antica/platform';

import type { MediaStoragePort } from '@antica/application/server';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated acceptance database',
  );
}

describe('Persistent multipart uploads', () => {
  it('should require ordered complete parts and verified originals before an idempotent database transition', async () => {
    const database = createDatabase({ url: databaseUrl });
    const ownerId = randomUUID();
    const clock = { now: (): string => '2026-10-13T00:00:00.000Z' };
    const transaction = createTransactionPort(database.db);
    const records = createRecordService(transaction, clock, {
      create: randomUUID,
    });
    const completeMultipart = vi.fn(async () => undefined);
    const verifyOriginal = vi.fn<MediaStoragePort['verifyOriginal']>(
      async () => undefined,
    );
    const parts = Array.from({ length: 4 }, (_, index) => ({
      partNumber: index + 1,
      offset: index * 16 * 1024 * 1024,
      byteLength: 16 * 1024 * 1024,
      putUrl: `https://storage.invalid/part/${index + 1}`,
      headers: {},
    }));
    const startMultipart = vi.fn(async () => ({
      uploadId: 'provider-upload',
      expiresAt: clock.now(),
      parts,
    }));
    const signUpload = vi.fn(async () => ({
      url: 'https://storage.invalid/single',
      expiresAt: clock.now(),
      headers: {},
    }));
    const media = createMediaService(
      transaction,
      {
        signUpload,
        startMultipart,
        completeMultipart,
        verifyOriginal,
        signRead: async () => ({
          url: 'https://storage.invalid/read',
          expiresAt: clock.now(),
        }),
      },
      clock,
      { create: randomUUID },
    );
    try {
      const record = await records.create(ownerId, randomUUID(), {
        unitKind: 'single',
      });
      if (!record.success) {
        throw new Error('Record fixture failed');
      }
      const input = {
        requestKey: randomUUID(),
        target: { kind: 'record' as const, recordId: record.data.id },
        kind: 'video' as const,
        purpose: 'object' as const,
        componentIds: [],
        fileName: 'object.mp4',
        mimeType: 'video/mp4',
        byteLength: 64 * 1024 * 1024,
        sha256: 'a'.repeat(64),
      };
      const belowThreshold = await media.start(ownerId, {
        ...input,
        requestKey: randomUUID(),
        byteLength: input.byteLength - 1,
      });
      expect(belowThreshold).toMatchObject({
        success: true,
        data: { mode: 'single' },
      });
      expect(startMultipart).not.toHaveBeenCalled();
      const started = await media.start(ownerId, input);
      expect(started).toMatchObject({
        success: true,
        data: { mode: 'multipart', parts },
      });
      if (!started.success) {
        throw new Error('Multipart fixture failed');
      }
      expect(await media.start(ownerId, input)).toEqual(started);
      expect(startMultipart).toHaveBeenCalledTimes(1);
      expect(signUpload).toHaveBeenCalledTimes(1);
      const etags = parts.map((part) => ({
        partNumber: part.partNumber,
        etag: `"part-${part.partNumber}"`,
      }));
      for (const invalid of [
        undefined,
        etags.slice(0, 3),
        [...etags].reverse(),
      ]) {
        expect(
          await media.complete(
            ownerId,
            started.data.assetId,
            randomUUID(),
            invalid,
          ),
        ).toMatchObject({
          success: false,
          error: { code: 'VALIDATION_FAILED' },
        });
      }
      expect(completeMultipart).not.toHaveBeenCalled();
      const key = randomUUID();
      verifyOriginal.mockRejectedValueOnce(
        new Error('Stored media checksum mismatch'),
      );
      expect(
        await media.complete(ownerId, started.data.assetId, key, etags),
      ).toMatchObject({ success: false, error: { code: 'UPLOAD_INCOMPLETE' } });
      expect(await media.get(ownerId, started.data.assetId)).toMatchObject({
        success: true,
        data: { asset: { state: 'awaiting_upload' }, processingJobId: null },
      });
      expect(
        await transaction.run(ownerId, async (unit) => ({
          success: true,
          data: await unit.outbox.pending(100),
        })),
      ).toEqual({ success: true, data: [] });
      const completed = await media.complete(
        ownerId,
        started.data.assetId,
        key,
        etags,
      );
      expect(completed).toMatchObject({
        success: true,
        data: { state: 'uploaded' },
      });
      expect(
        await media.complete(ownerId, started.data.assetId, key, etags),
      ).toEqual(completed);
      expect(completeMultipart).toHaveBeenCalledTimes(2);
      expect(completeMultipart).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sha256: input.sha256,
          byteLength: input.byteLength,
        }),
        'provider-upload',
        etags,
      );
      expect(
        await media.complete(
          ownerId,
          started.data.assetId,
          key,
          etags.map((part) => ({ ...part, etag: 'changed' })),
        ),
      ).toMatchObject({ success: false, error: { code: 'VALIDATION_FAILED' } });
      const pending = await transaction.run(ownerId, async (unit) => ({
        success: true,
        data: await unit.outbox.pending(100),
      }));
      expect(pending.data.map((event) => event.name)).toEqual([
        'antica.media.uploaded',
      ]);
      expect(await records.get(ownerId, record.data.id)).toMatchObject({
        success: true,
        data: {
          analysisInputVersion: 1,
          evidenceVersion: 1,
          latestRunId: null,
        },
      });
    } finally {
      await database.close();
    }
  });
});
