import { createHash } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';

import { originalKey } from '../../storage/media-store.js';

import {
  canonicalViews,
  mediaAssetComponents,
  mediaAssets,
  mediaDerivatives,
  sourceIntakes,
  uploadParts,
  uploadSessions,
} from '../schema/index.js';

import type {
  MediaDerivative,
  MediaRepository,
} from '@antica/application/ports';
import type { MediaAsset, UploadSession } from '@antica/contracts';
import type { CanonicalView } from '@antica/domain';

import type { Transaction } from '../transaction.js';

/**
 * binds upload declarations and derivative metadata to one collector
 * @param tx transaction shared with the enclosing owner-scoped operation
 * @param ownerId collector whose assets and uploads the repository may access
 * @returns repository for the collector's media assets and transfers
 */
export function createMediaRepository(
  tx: Transaction,
  ownerId: string,
): MediaRepository {
  async function get(id: string): Promise<MediaAsset | null> {
    const [row] = await tx
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, id),
          eq(mediaAssets.ownerId, ownerId),
          inArray(mediaAssets.purpose, [
            'object',
            'receipt',
            'voice_note',
            'book_page',
            'book_file',
          ]),
        ),
      );
    if (!row) {
      return null;
    }
    const [components, views] = await Promise.all([
      tx
        .select({ id: mediaAssetComponents.componentId })
        .from(mediaAssetComponents)
        .where(eq(mediaAssetComponents.assetId, id)),
      tx
        .select()
        .from(canonicalViews)
        .where(eq(canonicalViews.originalAssetId, id)),
    ]);
    const owner = row.recordId
      ? { kind: 'record' as const, recordId: row.recordId }
      : row.sourceIntakeId
        ? { kind: 'source_intake' as const, intakeKey: row.sourceIntakeId }
        : {
            kind: 'source_version' as const,
            sourceVersionId: row.sourceVersionId!,
          };

    return {
      id: row.id,
      owner,
      kind: row.kind as MediaAsset['kind'],
      purpose: row.purpose as MediaAsset['purpose'],
      state: row.state as MediaAsset['state'],
      componentIds: components.map((item) => item.id),
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
      byteLength: row.byteLength,
      sha256: row.sha256,
      durationMs: row.durationMs === null ? null : Number(row.durationMs),
      views: views.map((view) => ({
        id: view.id,
        originalAssetId: view.originalAssetId,
        derivativeId: view.derivativeId,
        width: view.width,
        height: view.height,
        originalCoordinateSpace:
          view.coordinateSpace as CanonicalView['originalCoordinateSpace'],
        transformToOriginal:
          view.transformToOriginal as CanonicalView['transformToOriginal'],
      })),
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }

  return {
    get,
    async createUpload(request, session) {
      const target = request.target;
      if (target.kind === 'source_intake') {
        await tx
          .insert(sourceIntakes)
          .values({ id: target.intakeKey, ownerId })
          .onConflictDoNothing();
      }
      const assetId = session.assetId;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            target,
            kind: request.kind,
            purpose: request.purpose,
            componentIds: [...request.componentIds].sort(),
            fileName: request.fileName,
            mimeType: request.mimeType,
            byteLength: request.byteLength,
            sha256: request.sha256,
          }),
        )
        .digest('hex');
      await tx.insert(mediaAssets).values({
        id: assetId,
        ownerId,
        recordId: target.kind === 'record' ? target.recordId : null,
        sourceIntakeId:
          target.kind === 'source_intake' ? target.intakeKey : null,
        kind: request.kind,
        purpose: request.purpose,
        state: 'awaiting_upload',
        objectKey: originalKey(assetId),
        originalFileName: request.fileName,
        mimeType: request.mimeType,
        byteLength: request.byteLength,
        sha256: request.sha256.toLowerCase(),
      });
      if (request.componentIds.length) {
        await tx.insert(mediaAssetComponents).values(
          request.componentIds.map((componentId) => ({
            assetId,
            componentId,
          })),
        );
      }
      await tx.insert(uploadSessions).values({
        assetId,
        ownerId,
        requestKey: request.requestKey,
        fingerprint,
        mode: session.mode,
        signedSession: session,
        providerUploadId:
          session.mode === 'multipart' ? session.uploadId : null,
        expiresAt: session.expiresAt,
      });
      if (session.mode === 'multipart' && session.parts.length) {
        await tx.insert(uploadParts).values(
          session.parts.map((part) => ({
            assetId,
            partNumber: part.partNumber,
            offset: part.offset,
            byteLength: part.byteLength,
          })),
        );
      }
    },
    async getUploadByRequestKey(
      requestOwnerId,
      requestKey,
    ): Promise<UploadSession | null> {
      if (requestOwnerId !== ownerId) {
        return null;
      }
      const [row] = await tx
        .select()
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.ownerId, ownerId),
            eq(uploadSessions.requestKey, requestKey),
          ),
        );

      return row ? (row.signedSession as UploadSession) : null;
    },
    async getUploadSession(assetId): Promise<UploadSession | null> {
      const [row] = await tx
        .select({ signedSession: uploadSessions.signedSession })
        .from(uploadSessions)
        .where(
          and(
            eq(uploadSessions.assetId, assetId),
            eq(uploadSessions.ownerId, ownerId),
          ),
        );

      return row ? (row.signedSession as UploadSession) : null;
    },
    async complete(id, completion) {
      const [row] = await tx
        .update(mediaAssets)
        .set({
          state: completion.state,
          verifiedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mediaAssets.id, id),
            eq(mediaAssets.ownerId, ownerId),
            eq(mediaAssets.state, 'awaiting_upload'),
          ),
        )
        .returning({ id: mediaAssets.id });
      if (!row) {
        throw new Error('Media upload is missing or already completed');
      }
    },
    async addDerivative(derivative) {
      const [original] = await tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, derivative.originalAssetId),
            eq(mediaAssets.ownerId, ownerId),
          ),
        );
      if (!original) {
        throw new Error('Original asset not found');
      }
      if (
        derivative.frame &&
        derivative.frame.frameDerivativeId !== derivative.id
      ) {
        throw new Error('Frame derivative ID mismatch');
      }
      await tx.insert(mediaDerivatives).values({
        id: derivative.id,
        ownerId,
        originalAssetId: derivative.originalAssetId,
        parentDerivativeId: derivative.parentDerivativeId,
        kind: derivative.kind,
        objectKey: derivative.storageKey,
        mimeType: derivative.mimeType,
        byteLength: derivative.byteLength,
        sha256: derivative.sha256,
        region: derivative.region,
        transform: derivative.transformToOriginal,
        streamIndex: derivative.frame?.streamIndex,
        pts: derivative.frame?.pts,
        timebaseNumerator: derivative.frame?.timeBase.numerator,
        timebaseDenominator: derivative.frame?.timeBase.denominator,
        displayTimeMs: derivative.frame
          ? String(derivative.frame.displayTimeMs)
          : null,
      });
    },
    async getDerivative(id): Promise<MediaDerivative | null> {
      const [row] = await tx
        .select()
        .from(mediaDerivatives)
        .where(
          and(
            eq(mediaDerivatives.id, id),
            eq(mediaDerivatives.ownerId, ownerId),
          ),
        );

      return row
        ? {
            id: row.id,
            originalAssetId: row.originalAssetId,
            parentDerivativeId: row.parentDerivativeId,
            kind: row.kind as MediaDerivative['kind'],
            storageKey: row.objectKey,
            mimeType: row.mimeType,
            byteLength: row.byteLength,
            sha256: row.sha256,
            region: row.region as MediaDerivative['region'],
            transformToOriginal:
              row.transform as MediaDerivative['transformToOriginal'],
            frame:
              row.streamIndex !== null &&
              row.pts !== null &&
              row.timebaseNumerator !== null &&
              row.timebaseDenominator !== null &&
              row.displayTimeMs !== null
                ? {
                    streamIndex: row.streamIndex,
                    pts: row.pts,
                    timeBase: {
                      numerator: row.timebaseNumerator,
                      denominator: row.timebaseDenominator,
                    },
                    frameDerivativeId: row.id,
                    displayTimeMs: Number(row.displayTimeMs),
                  }
                : undefined,
          }
        : null;
    },
    async getFrameByDerivative(id) {
      const [row] = await tx
        .select({
          id: mediaDerivatives.id,
          streamIndex: mediaDerivatives.streamIndex,
          pts: mediaDerivatives.pts,
          timebaseNumerator: mediaDerivatives.timebaseNumerator,
          timebaseDenominator: mediaDerivatives.timebaseDenominator,
          displayTimeMs: mediaDerivatives.displayTimeMs,
        })
        .from(mediaDerivatives)
        .where(
          and(
            eq(mediaDerivatives.id, id),
            eq(mediaDerivatives.ownerId, ownerId),
            eq(mediaDerivatives.kind, 'frame'),
          ),
        );

      if (
        !row ||
        row.streamIndex === null ||
        row.pts === null ||
        row.timebaseNumerator === null ||
        row.timebaseDenominator === null ||
        row.displayTimeMs === null
      ) {
        return null;
      }
      return {
        streamIndex: row.streamIndex,
        pts: row.pts,
        timeBase: {
          numerator: row.timebaseNumerator,
          denominator: row.timebaseDenominator,
        },
        frameDerivativeId: row.id,
        displayTimeMs: Number(row.displayTimeMs),
      };
    },
    async addCanonicalView(view) {
      const [original] = await tx
        .select({ id: mediaAssets.id })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.id, view.originalAssetId),
            eq(mediaAssets.ownerId, ownerId),
          ),
        );
      if (!original) {
        throw new Error('Original asset not found');
      }
      await tx.insert(canonicalViews).values({
        id: view.id,
        originalAssetId: view.originalAssetId,
        derivativeId: view.derivativeId,
        width: view.width,
        height: view.height,
        coordinateSpace: view.originalCoordinateSpace,
        transformToOriginal: view.transformToOriginal,
      });
    },
    async getCanonicalView(id): Promise<CanonicalView | null> {
      const [row] = await tx
        .select()
        .from(canonicalViews)
        .innerJoin(
          mediaAssets,
          and(
            eq(canonicalViews.originalAssetId, mediaAssets.id),
            eq(mediaAssets.ownerId, ownerId),
          ),
        )
        .where(eq(canonicalViews.id, id));

      return row
        ? {
            id: row.canonical_views.id,
            originalAssetId: row.canonical_views.originalAssetId,
            derivativeId: row.canonical_views.derivativeId,
            width: row.canonical_views.width,
            height: row.canonical_views.height,
            originalCoordinateSpace: row.canonical_views
              .coordinateSpace as CanonicalView['originalCoordinateSpace'],
            transformToOriginal: row.canonical_views
              .transformToOriginal as CanonicalView['transformToOriginal'],
          }
        : null;
    },
    async getCanonicalViewSource(viewId) {
      const [row] = await tx
        .select({
          originalAssetId: canonicalViews.originalAssetId,
          derivativeId: canonicalViews.derivativeId,
          originalKey: mediaAssets.objectKey,
          originalMimeType: mediaAssets.mimeType,
          derivativeKey: mediaDerivatives.objectKey,
          derivativeMimeType: mediaDerivatives.mimeType,
        })
        .from(canonicalViews)
        .innerJoin(
          mediaAssets,
          and(
            eq(canonicalViews.originalAssetId, mediaAssets.id),
            eq(mediaAssets.ownerId, ownerId),
          ),
        )
        .leftJoin(
          mediaDerivatives,
          and(
            eq(canonicalViews.derivativeId, mediaDerivatives.id),
            eq(
              mediaDerivatives.originalAssetId,
              canonicalViews.originalAssetId,
            ),
            eq(mediaDerivatives.ownerId, ownerId),
          ),
        )
        .where(eq(canonicalViews.id, viewId));
      if (!row) {
        return null;
      }
      if (row.derivativeId !== null) {
        if (row.derivativeKey === null || row.derivativeMimeType === null) {
          return null;
        }

        return {
          originalAssetId: row.originalAssetId,
          derivativeId: row.derivativeId,
          storageKey: row.derivativeKey,
          mimeType: row.derivativeMimeType,
        };
      }

      return {
        originalAssetId: row.originalAssetId,
        derivativeId: null,
        storageKey: row.originalKey,
        mimeType: row.originalMimeType,
      };
    },
    async markReadyOnce(assetId, expectedState) {
      const [row] = await tx
        .update(mediaAssets)
        .set({
          state: 'ready',
          readyVersionAppliedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(mediaAssets.id, assetId),
            eq(mediaAssets.ownerId, ownerId),
            eq(mediaAssets.state, expectedState),
            isNull(mediaAssets.readyVersionAppliedAt),
          ),
        )
        .returning({ id: mediaAssets.id });

      return Boolean(row);
    },
  };
}
