import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  canonicalViewSchema,
  regionSchema,
  uploadSessionSchema,
} from '@antica/contracts';

import { originalKey } from '../../storage/media-store.js';

import { Prisma } from '../generated/client.js';
import { jsonValue, nullableJson } from '../json.js';

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
    const row = await tx.mediaAssets.findFirst({
      where: {
        id,
        ownerId,
        purpose: {
          in: ['object', 'receipt', 'voice_note', 'book_page', 'book_file'],
        },
      },
    });
    if (!row) {
      return null;
    }
    const [components, views] = await Promise.all([
      tx.mediaAssetComponents.findMany({
        select: { componentId: true },
        where: { assetId: id },
      }),
      tx.canonicalViews.findMany({ where: { originalAssetId: id } }),
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
      componentIds: components.map((item) => item.componentId),
      originalFileName: row.originalFileName,
      mimeType: row.mimeType,
      byteLength: Number(row.byteLength),
      sha256: row.sha256,
      durationMs: row.durationMs === null ? null : Number(row.durationMs),
      views: views.map((view) =>
        canonicalViewSchema.parse({
          id: view.id,
          originalAssetId: view.originalAssetId,
          derivativeId: view.derivativeId,
          width: view.width,
          height: view.height,
          originalCoordinateSpace: view.coordinateSpace,
          transformToOriginal: view.transformToOriginal,
        }),
      ),
      createdAt: new Date(row.createdAt).toISOString(),
    };
  }

  return {
    get,

    async createUpload(request, session) {
      const target = request.target;
      if (target.kind === 'source_intake') {
        await tx.sourceIntakes.createMany({
          data: { id: target.intakeKey, ownerId },
          skipDuplicates: true,
        });
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
      await tx.mediaAssets.create({
        data: {
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
        },
      });
      if (request.componentIds.length) {
        await tx.mediaAssetComponents.createMany({
          data: request.componentIds.map((componentId) => ({
            assetId,
            componentId,
          })),
        });
      }
      await tx.$executeRaw(Prisma.sql`
        insert into upload_sessions (asset_id, owner_id, request_key, fingerprint, mode, signed_session,
          provider_upload_id, expires_at)
        values (${assetId}::uuid, ${ownerId}, ${request.requestKey}::uuid, ${fingerprint}, ${session.mode},
          ${JSON.stringify(session)}::jsonb, ${session.mode === 'multipart' ? session.uploadId : null},
          ${session.expiresAt}::timestamptz)
      `);
      if (session.mode === 'multipart' && session.parts.length) {
        await tx.uploadParts.createMany({
          data: session.parts.map((part) => ({
            assetId,
            partNumber: part.partNumber,
            offset: part.offset,
            byteLength: part.byteLength,
          })),
        });
      }
    },

    async getUploadByRequestKey(
      requestOwnerId,
      requestKey,
    ): Promise<UploadSession | null> {
      if (requestOwnerId !== ownerId) {
        return null;
      }
      const row = await tx.uploadSessions.findFirst({
        where: { ownerId, requestKey },
      });

      return row ? uploadSessionSchema.parse(row.signedSession) : null;
    },

    async getUploadSession(assetId): Promise<UploadSession | null> {
      const row = await tx.uploadSessions.findFirst({
        select: { signedSession: true },
        where: { assetId, ownerId },
      });

      return row ? uploadSessionSchema.parse(row.signedSession) : null;
    },

    async complete(id, completion) {
      const [row] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update media_assets set state = ${completion.state}, verified_at = now(), updated_at = now()
        where id = ${id}::uuid and owner_id = ${ownerId} and state = 'awaiting_upload'
        returning id
      `);
      if (!row) {
        throw new Error('Media upload is missing or already completed');
      }
    },

    async addDerivative(derivative) {
      const original = await tx.mediaAssets.findFirst({
        select: { id: true },
        where: { id: derivative.originalAssetId, ownerId },
      });
      if (!original) {
        throw new Error('Original asset not found');
      }
      if (
        derivative.frame &&
        derivative.frame.frameDerivativeId !== derivative.id
      ) {
        throw new Error('Frame derivative ID mismatch');
      }
      await tx.mediaDerivatives.create({
        data: {
          id: derivative.id,
          ownerId,
          originalAssetId: derivative.originalAssetId,
          parentDerivativeId: derivative.parentDerivativeId,
          kind: derivative.kind,
          objectKey: derivative.storageKey,
          mimeType: derivative.mimeType,
          byteLength: derivative.byteLength,
          sha256: derivative.sha256,
          region: nullableJson(derivative.region),
          transform: jsonValue(derivative.transformToOriginal),
          streamIndex: derivative.frame?.streamIndex,
          pts: derivative.frame?.pts,
          timebaseNumerator: derivative.frame?.timeBase.numerator,
          timebaseDenominator: derivative.frame?.timeBase.denominator,
          displayTimeMs: derivative.frame
            ? String(derivative.frame.displayTimeMs)
            : null,
        },
      });
    },

    async getDerivative(id): Promise<MediaDerivative | null> {
      const row = await tx.mediaDerivatives.findFirst({
        where: { id, ownerId },
      });

      return row
        ? {
            id: row.id,
            originalAssetId: row.originalAssetId,
            parentDerivativeId: row.parentDerivativeId,
            kind: row.kind as MediaDerivative['kind'],
            storageKey: row.objectKey,
            mimeType: row.mimeType,
            byteLength: Number(row.byteLength),
            sha256: row.sha256,
            region: regionSchema.nullable().parse(row.region),
            transformToOriginal: z
              .tuple([
                z.number(),
                z.number(),
                z.number(),
                z.number(),
                z.number(),
                z.number(),
                z.number(),
                z.number(),
                z.number(),
              ])
              .parse(row.transform),
            frame:
              row.streamIndex !== null &&
              row.pts !== null &&
              row.timebaseNumerator !== null &&
              row.timebaseDenominator !== null &&
              row.displayTimeMs !== null
                ? {
                    streamIndex: row.streamIndex,
                    pts: row.pts.toFixed(0),
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
      const row = await tx.mediaDerivatives.findFirst({
        where: { id, ownerId, kind: 'frame' },
      });

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
        pts: row.pts.toFixed(0),
        timeBase: {
          numerator: row.timebaseNumerator,
          denominator: row.timebaseDenominator,
        },
        frameDerivativeId: row.id,
        displayTimeMs: Number(row.displayTimeMs),
      };
    },

    async addCanonicalView(view) {
      const original = await tx.mediaAssets.findFirst({
        select: { id: true },
        where: { id: view.originalAssetId, ownerId },
      });
      if (!original) {
        throw new Error('Original asset not found');
      }
      await tx.canonicalViews.create({
        data: {
          id: view.id,
          originalAssetId: view.originalAssetId,
          derivativeId: view.derivativeId,
          width: view.width,
          height: view.height,
          coordinateSpace: view.originalCoordinateSpace,
          transformToOriginal: jsonValue(view.transformToOriginal),
        },
      });
    },

    async getCanonicalView(id): Promise<CanonicalView | null> {
      const row = await tx.canonicalViews.findFirst({
        where: { id, mediaAssets: { ownerId } },
      });

      return row
        ? canonicalViewSchema.parse({
            id: row.id,
            originalAssetId: row.originalAssetId,
            derivativeId: row.derivativeId,
            width: row.width,
            height: row.height,
            originalCoordinateSpace: row.coordinateSpace,
            transformToOriginal: row.transformToOriginal,
          })
        : null;
    },

    async getCanonicalViewSource(viewId) {
      const [row] = await tx.$queryRaw<
        Array<{
          originalAssetId: string;
          derivativeId: string | null;
          originalKey: string;
          originalMimeType: string;
          derivativeKey: string | null;
          derivativeMimeType: string | null;
        }>
      >(Prisma.sql`
        select view.original_asset_id as "originalAssetId", view.derivative_id as "derivativeId",
          original.object_key as "originalKey", original.mime_type as "originalMimeType",
          derivative.object_key as "derivativeKey", derivative.mime_type as "derivativeMimeType"
        from canonical_views view
        inner join media_assets original on view.original_asset_id = original.id and original.owner_id = ${ownerId}
        left join media_derivatives derivative on view.derivative_id = derivative.id
          and derivative.original_asset_id = view.original_asset_id and derivative.owner_id = ${ownerId}
        where view.id = ${viewId}::uuid
      `);
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
      const [row] = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update media_assets set state = 'ready', ready_version_applied_at = now(), updated_at = now()
        where id = ${assetId}::uuid and owner_id = ${ownerId} and state = ${expectedState}
          and ready_version_applied_at is null returning id
      `);

      return Boolean(row);
    },
  };
}
