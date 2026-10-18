import { createHash, randomUUID } from 'node:crypto';

import { artifactKey } from '../storage/media-store.js';

import { Prisma } from './generated/client.js';

import type { CanonicalView } from '@antica/domain';

import type {
  LocalSourceParserParams,
  ParsingAsset,
} from '../parsing/local.js';
import type { MediaStore } from '../storage/media-store.js';

import type { Database } from './connection.js';

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
    /** @param versionId */
    async resolveSource(
      versionId: string,
    ): Promise<{ readonly sourceId: string }> {
      if (versionId !== sourceVersionId) {
        throw new Error('Source version mismatch');
      }
      const [row] = await db.sourceVersions.findMany({
        where: { AND: [{ id: versionId }, { ownerId }] },
        select: { sourceId: true },
      });
      if (!row) {
        throw new Error('Source version is inaccessible');
      }

      return row;
    },
    /** @param assetId */
    async readAsset(assetId: string): Promise<ParsingAsset> {
      const registration = await db.sourceVersionAssets.findFirst({
        where: {
          versionId: sourceVersionId,
          assetId,
          sourceVersions: { ownerId },
          mediaAssets: { ownerId },
        },
        include: { mediaAssets: true },
      });
      const row = registration
        ? {
            ...registration.mediaAssets,
            key: registration.mediaAssets.objectKey,
            printedPageLabel: registration.printedLabel,
            presentation: registration.presentation,
          }
        : null;
      if (!row) {
        throw new Error('Source asset is inaccessible');
      }
      const [view] = await db.$queryRaw<CanonicalView[]>(Prisma.sql`
        select id, original_asset_id as "originalAssetId",
          derivative_id as "derivativeId", width, height,
          coordinate_space as "originalCoordinateSpace",
          transform_to_original as "transformToOriginal"
        from canonical_views
        where original_asset_id = ${assetId}::uuid
        limit 1
      `);
      const stored = await storage.read(row.key);
      if (
        BigInt(stored.bytes.byteLength) !== row.byteLength ||
        createHash('sha256').update(stored.bytes).digest('hex') !== row.sha256
      ) {
        throw new Error('Source asset integrity mismatch');
      }
      const canonical = view ?? null;

      return {
        id: assetId,
        mimeType: row.mimeType,
        bytes: stored.bytes,
        printedPageLabel: row.printedPageLabel,
        view: canonical,
        presentation: row.presentation as ParsingAsset['presentation'],
      };
    },
    /**
     * @param bytes
     * @param mimeType
     */
    async writeArtifact(bytes: Uint8Array, mimeType: string): Promise<string> {
      if (!bytes.byteLength || !mimeType) {
        throw new Error('Artifact bytes and MIME type are required');
      }
      const [version] = await db.sourceVersions.findMany({
        where: { AND: [{ id: sourceVersionId }, { ownerId }] },
        select: { id: true },
      });
      if (!version) {
        throw new Error('Source version is inaccessible');
      }
      const assetId = randomUUID();
      const key = artifactKey(sourceVersionId, parseRunId, assetId);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await storage.writeArtifact({ key, bytes, mimeType });
      await db.$transaction(async (tx) => {
        await tx.mediaAssets.createMany({
          data: {
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
          },
        });
        await tx.sourceArtifacts.createMany({
          data: {
            assetId,
            ownerId,
            sourceVersionId,
            parseRunId,
            kind: 'raw_parse_output',
          },
        });
      });

      return assetId;
    },
    /** @param assetId */
    async readArtifact(
      assetId: string,
    ): Promise<{ readonly bytes: Uint8Array; readonly mimeType: string }> {
      const artifact = await db.sourceArtifacts.findFirst({
        where: { assetId, ownerId, sourceVersionId, mediaAssets: { ownerId } },
        include: { mediaAssets: true },
      });
      const row = artifact
        ? { ...artifact.mediaAssets, key: artifact.mediaAssets.objectKey }
        : null;
      if (!row) {
        throw new Error('Source artifact is inaccessible');
      }
      const stored = await storage.read(row.key);
      if (
        BigInt(stored.bytes.byteLength) !== row.byteLength ||
        createHash('sha256').update(stored.bytes).digest('hex') !== row.sha256
      ) {
        throw new Error('Source artifact integrity mismatch');
      }

      return { bytes: stored.bytes, mimeType: row.mimeType };
    },
  };
}
