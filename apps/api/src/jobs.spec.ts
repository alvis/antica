import { describe, expect, it, vi } from 'vitest';

import * as workers from '@antica/application/server';
import { collectorUserId } from '@antica/platform';

import { createLocalSettings } from './fixtures/runtime.js';
import { createApplicationDrain } from './jobs.js';
import { createPersistence } from './persistence.js';
import { createImageProviders, createTextProvider } from './retrieval.js';

import type { MediaProcessorPort } from '@antica/application/server';
import type { QdrantImageWriter } from '@antica/platform/search';

vi.mock('@antica/platform', async (importOriginal) => {
  const original = await importOriginal<typeof import('@antica/platform')>();

  return {
    ...original,
    ensureCollectorUser: vi.fn(async () => original.collectorUserId),
  } satisfies typeof original;
});

const input = {
  ownerId: collectorUserId,
  asset: {
    id: '00000000-0000-4000-8000-000000000002',
    owner: { kind: 'record', recordId: '00000000-0000-4000-8000-000000000001' },
    kind: 'photo',
    purpose: 'object',
    state: 'uploaded',
    componentIds: [],
    originalFileName: 'capture.jpg',
    mimeType: 'image/jpeg',
    byteLength: 4,
    sha256: 'a'.repeat(64),
    durationMs: null,
    views: [],
    createdAt: '2026-10-18T00:00:00.000Z',
  },
  derivative: {
    id: '00000000-0000-4000-8000-000000000003',
    originalAssetId: '00000000-0000-4000-8000-000000000002',
    parentDerivativeId: null,
    kind: 'canonical',
    storageKey: 'derivatives/capture',
    mimeType: 'image/jpeg',
    byteLength: 4,
    sha256: 'b'.repeat(64),
    region: null,
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
  view: {
    id: '00000000-0000-4000-8000-000000000004',
    originalAssetId: '00000000-0000-4000-8000-000000000002',
    derivativeId: '00000000-0000-4000-8000-000000000003',
    width: 4,
    height: 4,
    originalCoordinateSpace: 'image_pixels',
    transformToOriginal: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  },
} satisfies Parameters<NonNullable<MediaProcessorPort['indexImage']>>[0];

describe('fn:createApplicationDrain', () => {
  it('should deny foreign owners and non-record media at the composed indexing boundaries', async () => {
    const settings = createLocalSettings();
    const persistence = await createPersistence(settings.app);
    const upsert = vi.fn<QdrantImageWriter['upsert']>(async () => ({
      success: true,
      data: null,
    }));
    const mediaFactory = vi.spyOn(workers, 'createMediaJobHandler');
    const sourceFactory = vi.spyOn(workers, 'createSourceIngestionHandler');
    const readEntries = vi.spyOn(persistence.readers, 'readImageEntries');
    try {
      createApplicationDrain({
        settings,
        persistence,
        images: {
          ...createImageProviders(settings, persistence),
          writer: { upsert },
        },
        text: createTextProvider(settings, persistence),
      });
      const processor = mediaFactory.mock.calls[0]![1];
      const indexing = sourceFactory.mock.calls[0]![0].indexing!.image;
      if (indexing.kind !== 'external' || !processor.indexImage) {
        throw new Error('Expected configured external index hooks');
      }

      expect(
        await processor.indexImage({ ...input, ownerId: 'foreign-owner' }),
      ).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN', retryable: false },
      });
      expect(
        await processor.indexImage({
          ...input,
          asset: {
            ...input.asset,
            owner: {
              kind: 'source_version',
              sourceVersionId: '00000000-0000-4000-8000-000000000005',
            },
          },
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN', retryable: false },
      });
      expect(
        await indexing.writer.index('foreign-owner', {
          sourceVersionId: '00000000-0000-4000-8000-000000000005',
          parseRunId: '00000000-0000-4000-8000-000000000006',
          rawOutputAssetId: '00000000-0000-4000-8000-000000000007',
          pages: [],
          regions: [],
          images: [],
          warnings: [],
        }),
      ).toMatchObject({
        success: false,
        error: { code: 'FORBIDDEN', retryable: false },
      });
      vi.spyOn(persistence.transaction, 'run').mockResolvedValueOnce({
        success: true,
        data: null,
      });
      expect(await processor.indexImage(input)).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND', retryable: false },
      });
      expect(readEntries).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    } finally {
      await persistence.database.close();
    }
  });
});
