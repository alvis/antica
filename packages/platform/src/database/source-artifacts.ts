import { createHash, randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from './connection.js';
import {
  canonicalViews,
  mediaAssets,
  sourceArtifacts,
  sourceVersionAssets,
  sourceVersions,
} from './schema/index.js';
import type { MediaStore } from '../storage/media-store.js';
import { artifactKey } from '../storage/media-store.js';
import type {
  LocalSourceParserParams,
  ParsingAsset,
} from '../parsing/local.js';
import type { CanonicalView } from '@antica/domain';

/** owner and parse-run context for immutable source artifacts */
export interface SourceArtifactAccessParams {
  readonly db: Database;
  readonly storage: MediaStore;
  readonly ownerId: string;
  readonly sourceVersionId: string;
  readonly parseRunId: string;
}

/** parser inputs and owner-scoped reads of persisted source artifacts */
export interface SourceArtifactAccess extends LocalSourceParserParams {
  readonly readArtifact: (
    assetId: string,
  ) => Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }>;
}

/**
 * creates immutable parser artifacts with durable source-version and parse-run provenance
 * @param params owner, version, parse run, database, and private storage context
 * @returns authorized parser readers and durable artifact access
 */
export function createSourceArtifactAccess(
  params: SourceArtifactAccessParams,
): SourceArtifactAccess {
  const { db, storage, ownerId, sourceVersionId, parseRunId } = params;
  return {
    async resolveSource(
      versionId: string,
    ): Promise<{ readonly sourceId: string }> {
      if (versionId !== sourceVersionId) {
        throw new Error('Source version mismatch');
      }
      const [row] = await db
        .select({ sourceId: sourceVersions.sourceId })
        .from(sourceVersions)
        .where(
          and(
            eq(sourceVersions.id, versionId),
            eq(sourceVersions.ownerId, ownerId),
          ),
        );
      if (!row) {
        throw new Error('Source version is inaccessible');
      }
      return row;
    },
    async readAsset(assetId: string): Promise<ParsingAsset> {
      const [row] = await db
        .select({
          key: mediaAssets.objectKey,
          mimeType: mediaAssets.mimeType,
          byteLength: mediaAssets.byteLength,
          sha256: mediaAssets.sha256,
          printedPageLabel: sourceVersionAssets.printedLabel,
          presentation: sourceVersionAssets.presentation,
        })
        .from(sourceVersionAssets)
        .innerJoin(
          sourceVersions,
          eq(sourceVersionAssets.versionId, sourceVersions.id),
        )
        .innerJoin(mediaAssets, eq(sourceVersionAssets.assetId, mediaAssets.id))
        .where(
          and(
            eq(sourceVersionAssets.versionId, sourceVersionId),
            eq(sourceVersionAssets.assetId, assetId),
            eq(sourceVersions.ownerId, ownerId),
            eq(mediaAssets.ownerId, ownerId),
          ),
        );
      if (!row) {
        throw new Error('Source asset is inaccessible');
      }
      const [view] = await db
        .select()
        .from(canonicalViews)
        .where(eq(canonicalViews.originalAssetId, assetId))
        .limit(1);
      const stored = await storage.read(row.key);
      if (
        stored.bytes.byteLength !== row.byteLength ||
        createHash('sha256').update(stored.bytes).digest('hex') !== row.sha256
      ) {
        throw new Error('Source asset integrity mismatch');
      }
      const canonical: CanonicalView | null = view
        ? {
            id: view.id,
            originalAssetId: view.originalAssetId,
            derivativeId: view.derivativeId,
            width: view.width,
            height: view.height,
            originalCoordinateSpace:
              view.coordinateSpace as CanonicalView['originalCoordinateSpace'],
            transformToOriginal:
              view.transformToOriginal as CanonicalView['transformToOriginal'],
          }
        : null;
      return {
        id: assetId,
        mimeType: row.mimeType,
        bytes: stored.bytes,
        printedPageLabel: row.printedPageLabel,
        view: canonical,
        presentation: row.presentation as ParsingAsset['presentation'],
      };
    },
    async writeArtifact(bytes: Uint8Array, mimeType: string): Promise<string> {
      if (!bytes.byteLength || !mimeType) {
        throw new Error('Artifact bytes and MIME type are required');
      }
      const [version] = await db
        .select({ id: sourceVersions.id })
        .from(sourceVersions)
        .where(
          and(
            eq(sourceVersions.id, sourceVersionId),
            eq(sourceVersions.ownerId, ownerId),
          ),
        );
      if (!version) {
        throw new Error('Source version is inaccessible');
      }
      const assetId = randomUUID();
      const key = artifactKey(sourceVersionId, parseRunId, assetId);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await storage.writeArtifact({ key, bytes, mimeType });
      await db.transaction(async (tx) => {
        await tx.insert(mediaAssets).values({
          id: assetId,
          ownerId,
          sourceVersionId,
          kind: 'document',
          purpose: 'parse_artifact',
          state: 'ready',
          objectKey: key,
          originalFileName: `parse-${parseRunId}`,
          mimeType,
          byteLength: bytes.byteLength,
          sha256,
          verifiedAt: new Date().toISOString(),
        });
        await tx.insert(sourceArtifacts).values({
          assetId,
          ownerId,
          sourceVersionId,
          parseRunId,
          kind: 'raw_parse_output',
        });
      });
      return assetId;
    },
    async readArtifact(
      assetId: string,
    ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
      const [row] = await db
        .select({
          key: mediaAssets.objectKey,
          mimeType: mediaAssets.mimeType,
          byteLength: mediaAssets.byteLength,
          sha256: mediaAssets.sha256,
        })
        .from(sourceArtifacts)
        .innerJoin(mediaAssets, eq(sourceArtifacts.assetId, mediaAssets.id))
        .where(
          and(
            eq(sourceArtifacts.assetId, assetId),
            eq(sourceArtifacts.ownerId, ownerId),
            eq(mediaAssets.ownerId, ownerId),
            eq(sourceArtifacts.sourceVersionId, sourceVersionId),
          ),
        );
      if (!row) {
        throw new Error('Source artifact is inaccessible');
      }
      const stored = await storage.read(row.key);
      if (
        stored.bytes.byteLength !== row.byteLength ||
        createHash('sha256').update(stored.bytes).digest('hex') !== row.sha256
      ) {
        throw new Error('Source artifact integrity mismatch');
      }
      return { bytes: stored.bytes, mimeType: row.mimeType };
    },
  };
}
