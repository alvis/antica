import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { createLocalMediaStore } from '../storage/local.js';
import { originalKey } from '../storage/media-store.js';

import { createDatabase } from './connection.js';
import {
  canonicalViews,
  mediaAssets,
  sourceArtifacts,
  sources,
  sourceVersionAssets,
  sourceVersions,
} from './schema/index.js';
import { createSourceArtifactAccess } from './source-artifacts.js';

import type { SourceMetadata } from '@antica/domain';

const databaseUrl = process.env.ANTICA_TEST_DATABASE_URL ?? '';
if (!databaseUrl) {
  throw new Error(
    'ANTICA_TEST_DATABASE_URL must identify an isolated migrated database',
  );
}

describe('fn:createSourceArtifactAccess', () => {
  it('should bind a stored parser artifact and original asset to their owner and source version', async () => {
    const database = createDatabase({ url: databaseUrl, maxConnections: 1 });
    const root = await mkdtemp(join(tmpdir(), 'antica-source-artifact-'));
    const storage = createLocalMediaStore({
      root,
      publicBaseUrl: 'http://localhost:8080',
      signingSecret: 'artifact-test-signing-secret-32-characters',
    });
    const ownerId = randomUUID();
    const sourceId = randomUUID();
    const sourceVersionId = randomUUID();
    const parseRunId = randomUUID();
    const originalAssetId = randomUUID();
    const originalBytes = Buffer.from('%PDF-1.4\n%%EOF\n');
    const sourceHash = createHash('sha256').update(originalBytes).digest('hex');
    const metadata: SourceMetadata = {
      title: 'Catalog volume',
      contributors: [],
      authorStatus: 'unknown',
      editionStatement: null,
      publisher: null,
      publicationDateAsPrinted: null,
      isbn: null,
      languages: ['en'],
      canonicalUrl: null,
      access: 'stored_copy',
      rightsStatement: null,
      attributionText: null,
    };
    try {
      await database.db.insert(sources).values({
        id: sourceId,
        ownerId,
        kind: 'book_pdf',
        currentVersionId: sourceVersionId,
        title: metadata.title,
        authorStatus: metadata.authorStatus,
        access: metadata.access,
      });
      await database.db.insert(sourceVersions).values({
        id: sourceVersionId,
        sourceId,
        ownerId,
        sourceHash,
        metadataSnapshot: metadata,
        capturedAt: '2026-10-13T04:00:00.000Z',
        status: 'registered',
        textIndexStatus: 'registered',
        imageIndexStatus: 'registered',
      });
      const key = originalKey(originalAssetId);
      await database.db.insert(mediaAssets).values({
        id: originalAssetId,
        ownerId,
        sourceVersionId,
        kind: 'document',
        purpose: 'source_original',
        state: 'ready',
        objectKey: key,
        originalFileName: 'catalog.pdf',
        mimeType: 'application/pdf',
        byteLength: originalBytes.byteLength,
        sha256: sourceHash,
      });
      await database.db.insert(sourceVersionAssets).values({
        versionId: sourceVersionId,
        assetId: originalAssetId,
        ordinal: 0,
        printedLabel: 'Cover',
        presentation: null,
      });
      const upload = await storage.signUpload({
        assetId: originalAssetId,
        key,
        mimeType: 'application/pdf',
        byteLength: originalBytes.byteLength,
        sha256: sourceHash,
      });
      await storage.acceptUploadToken(
        new URL(upload.url).pathname.split('/').at(-1)!,
        originalBytes,
        'application/pdf',
      );
      const access = createSourceArtifactAccess({
        db: database.db,
        storage,
        ownerId,
        sourceVersionId,
        parseRunId,
      });
      const foreign = createSourceArtifactAccess({
        db: database.db,
        storage,
        ownerId: randomUUID(),
        sourceVersionId,
        parseRunId,
      });

      expect(await access.resolveSource(sourceVersionId)).toEqual({ sourceId });
      await expect(access.resolveSource(randomUUID())).rejects.toThrow(
        /version mismatch/i,
      );
      await expect(foreign.resolveSource(sourceVersionId)).rejects.toThrow(
        /inaccessible/i,
      );
      expect(await access.readAsset(originalAssetId)).toEqual({
        id: originalAssetId,
        mimeType: 'application/pdf',
        bytes: originalBytes,
        printedPageLabel: 'Cover',
        view: null,
        presentation: null,
      });
      await expect(foreign.readAsset(originalAssetId)).rejects.toThrow(
        /inaccessible/i,
      );
      await expect(access.readAsset(randomUUID())).rejects.toThrow(
        /inaccessible/i,
      );
      const viewId = randomUUID();
      const transformToOriginal = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      await database.db.insert(canonicalViews).values({
        id: viewId,
        originalAssetId,
        width: 600,
        height: 800,
        coordinateSpace: 'pdf_page_points',
        transformToOriginal,
      });
      expect(await access.readAsset(originalAssetId)).toMatchObject({
        view: {
          id: viewId,
          originalAssetId,
          derivativeId: null,
          width: 600,
          height: 800,
          originalCoordinateSpace: 'pdf_page_points',
          transformToOriginal,
        },
      });

      await expect(
        access.writeArtifact(new Uint8Array(), 'application/json'),
      ).rejects.toThrow(/required/i);
      await expect(
        access.writeArtifact(Buffer.from('data'), ''),
      ).rejects.toThrow(/required/i);
      await expect(
        foreign.writeArtifact(Buffer.from('data'), 'application/json'),
      ).rejects.toThrow(/inaccessible/i);

      const artifactBytes = Buffer.from('{"page":1,"text":"Catalog"}');
      const artifactId = await access.writeArtifact(
        artifactBytes,
        'application/json',
      );
      expect(await access.readArtifact(artifactId)).toEqual({
        bytes: artifactBytes,
        mimeType: 'application/json',
      });
      const [stored] = await database.db
        .select()
        .from(sourceArtifacts)
        .where(eq(sourceArtifacts.assetId, artifactId));
      expect(stored).toMatchObject({
        ownerId,
        sourceVersionId,
        parseRunId,
        kind: 'raw_parse_output',
      });
      await expect(foreign.readArtifact(artifactId)).rejects.toThrow(
        /inaccessible/i,
      );
      await expect(access.readArtifact(randomUUID())).rejects.toThrow(
        /inaccessible/i,
      );

      await database.db
        .update(mediaAssets)
        .set({ sha256: '0'.repeat(64) })
        .where(eq(mediaAssets.id, originalAssetId));
      await expect(access.readAsset(originalAssetId)).rejects.toThrow(
        /integrity mismatch/i,
      );
      await database.db
        .update(mediaAssets)
        .set({ sha256: '0'.repeat(64) })
        .where(eq(mediaAssets.id, artifactId));
      await expect(access.readArtifact(artifactId)).rejects.toThrow(
        /integrity mismatch/i,
      );
    } finally {
      await database.db
        .delete(sourceArtifacts)
        .where(eq(sourceArtifacts.sourceVersionId, sourceVersionId));
      await database.db
        .delete(sourceVersionAssets)
        .where(eq(sourceVersionAssets.versionId, sourceVersionId));
      await database.db
        .delete(canonicalViews)
        .where(eq(canonicalViews.originalAssetId, originalAssetId));
      await database.db
        .delete(mediaAssets)
        .where(eq(mediaAssets.sourceVersionId, sourceVersionId));
      await database.db
        .delete(sourceVersions)
        .where(eq(sourceVersions.id, sourceVersionId));
      await database.db.delete(sources).where(eq(sources.id, sourceId));
      await database.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
