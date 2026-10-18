import { Prisma } from '../generated/client.js';

import type { EvidenceRepository } from '@antica/application/ports';
import type { CursorPage } from '@antica/contracts';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';

import type { Transaction } from '../transaction.js';

function scopeKey(componentIds: readonly string[]): string {
  return [...new Set(componentIds)].sort().join(',');
}

function pageCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function iso(instant: Date): string {
  return new Date(instant).toISOString();
}

/**
 * binds evidence, collector observations and pinned checks to one owner
 * @param tx
 * @param ownerId
 */
export function createEvidenceRepository(
  tx: Transaction,
  ownerId: string,
): EvidenceRepository {
  async function getAnchor(id: string): Promise<EvidenceAnchor | null> {
    const row = await tx.evidenceAnchors.findFirst({ where: { id, ownerId } });
    if (!row) {
      return null;
    }
    const components = await tx.anchorComponents
      .findMany({ select: { componentId: true }, where: { anchorId: id } })
      .then((rows) => rows.map((row) => ({ id: row.componentId })));
    const scope =
      row.scopeKind === 'whole'
        ? { kind: 'whole' as const }
        : {
            kind: 'region' as const,
            region: row.region as Extract<
              EvidenceAnchor['scope'],
              { kind: 'region' }
            >['region'],
            cropDerivativeId: row.cropDerivativeId,
          };
    const base = {
      id: row.id,
      recordId: row.recordId,
      componentIds: components.map((item) => item.id),
      originalAssetId: row.originalAssetId,
      canonicalViewId: row.canonicalViewId,
      scope,
      createdAt: iso(row.createdAt),
    };

    return row.kind === 'video_frame'
      ? {
          ...base,
          kind: 'video_frame',
          frame: {
            streamIndex: row.frameStreamIndex!,
            timeBase: {
              numerator: row.frameTimebaseNumerator!,
              denominator: row.frameTimebaseDenominator!,
            },
            pts: row.framePts!,
            frameDerivativeId: row.frameDerivativeId!,
            displayTimeMs: row.frameDisplayTimeMs!,
          },
        }
      : { ...base, kind: 'image' };
  }

  async function getObservation(id: string): Promise<Observation | null> {
    const row = await tx.observations.findFirst({ where: { id, ownerId } });
    if (!row) {
      return null;
    }
    const [components, anchors, checks] = await Promise.all([
      tx.observationComponents
        .findMany({
          select: { componentId: true },
          where: { observationId: id },
        })
        .then((rows) => rows.map((row) => ({ id: row.componentId }))),
      tx.observationAnchors
        .findMany({ select: { anchorId: true }, where: { observationId: id } })
        .then((rows) => rows.map((row) => ({ id: row.anchorId }))),
      tx.checkObservations
        .findMany({ select: { checkId: true }, where: { observationId: id } })
        .then((rows) => rows.map((row) => ({ id: row.checkId }))),
    ]);

    return {
      id: row.id,
      recordId: row.recordId,
      componentIds: components.map((item) => item.id),
      channel: row.channel as Observation['channel'],
      text: row.text,
      evidenceAnchorIds: anchors.map((item) => item.id),
      checkIds: checks.map((item) => item.id),
      observedAt: iso(row.observedAt),
      voice:
        row.audioAssetId && row.transcriptionId
          ? {
              audioAssetId: row.audioAssetId,
              transcriptionId: row.transcriptionId,
              segmentId: row.segmentId,
            }
          : null,
      editDraftId: row.editDraftId,
      supersedesObservationId: row.supersedesId,
      author: 'collector',
      createdAt: iso(row.createdAt),
      supersededByObservationId: row.supersededById,
    };
  }

  async function getCheck(id: string): Promise<RecordCheck | null> {
    const row = await tx.recordChecks.findFirst({ where: { id, ownerId } });
    if (!row) {
      return null;
    }
    const [components, observationIds, anchorIds] = await Promise.all([
      tx.checkComponents
        .findMany({ select: { componentId: true }, where: { checkId: id } })
        .then((rows) => rows.map((row) => ({ id: row.componentId }))),
      tx.checkObservations
        .findMany({ select: { observationId: true }, where: { checkId: id } })
        .then((rows) => rows.map((row) => ({ id: row.observationId }))),
      tx.checkAnchors
        .findMany({ select: { anchorId: true }, where: { checkId: id } })
        .then((rows) => rows.map((row) => ({ id: row.anchorId }))),
    ]);
    const result: RecordCheck['result'] =
      row.resultKind === 'undetermined' || row.resultKind === 'not_applicable'
        ? { kind: row.resultKind, reason: row.resultReason! }
        : { kind: row.resultKind as 'unrecorded' | 'present' | 'absent' };

    return {
      id: row.id,
      revision: row.revision,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      recordId: row.recordId,
      componentIds: components.map((item) => item.id),
      methodId: row.methodId,
      methodVersionId: row.methodVersionId,
      suggestedByRunId: row.suggestedByRunId,
      progress: row.progress as RecordCheck['progress'],
      result,
      observationIds: observationIds.map((item) => item.id),
      evidenceAnchorIds: anchorIds.map((item) => item.id),
      pendingActionIds: [],
    };
  }

  return {
    getAnchor,

    async queryAnchorsByAsset(assetId) {
      const rows = await tx.evidenceAnchors.findMany({
        select: { id: true },
        where: { ownerId, originalAssetId: assetId },
      });

      return (
        await Promise.all(rows.map(async (row) => getAnchor(row.id)))
      ).filter((item): item is EvidenceAnchor => item !== null);
    },

    async addAnchor(anchor) {
      await tx.$executeRaw(Prisma.sql`
        insert into evidence_anchors (id, owner_id, record_id, original_asset_id, canonical_view_id,
          kind, scope_kind, region, crop_derivative_id, frame_stream_index, frame_timebase_numerator,
          frame_timebase_denominator, frame_pts, frame_derivative_id, frame_display_time_ms, created_at)
        values (${anchor.id}::uuid, ${ownerId}, ${anchor.recordId}::uuid, ${anchor.originalAssetId}::uuid,
          ${anchor.canonicalViewId}::uuid, ${anchor.kind}, ${anchor.scope.kind},
          ${anchor.scope.kind === 'region' ? JSON.stringify(anchor.scope.region) : null}::jsonb,
          ${anchor.scope.kind === 'region' ? anchor.scope.cropDerivativeId : null}::uuid,
          ${anchor.kind === 'video_frame' ? anchor.frame.streamIndex : null},
          ${anchor.kind === 'video_frame' ? anchor.frame.timeBase.numerator : null},
          ${anchor.kind === 'video_frame' ? anchor.frame.timeBase.denominator : null},
          ${anchor.kind === 'video_frame' ? anchor.frame.pts : null},
          ${anchor.kind === 'video_frame' ? anchor.frame.frameDerivativeId : null}::uuid,
          ${anchor.kind === 'video_frame' ? anchor.frame.displayTimeMs : null}, ${anchor.createdAt}::timestamptz)
      `);
      if (anchor.componentIds.length) {
        await tx.anchorComponents.createMany({
          data: anchor.componentIds.map((componentId) => ({
            anchorId: anchor.id,
            componentId,
          })),
        });
      }
    },
    getObservation,

    async addObservation(observation) {
      await tx.$executeRaw(Prisma.sql`
        insert into observations (id, owner_id, record_id, channel, text, observed_at, audio_asset_id,
          transcription_id, segment_id, edit_draft_id, supersedes_id, superseded_by_id, created_at)
        values (${observation.id}::uuid, ${ownerId}, ${observation.recordId}::uuid,
          ${observation.channel}, ${observation.text}, ${observation.observedAt}::timestamptz,
          ${observation.voice?.audioAssetId ?? null}::uuid, ${observation.voice?.transcriptionId ?? null}::uuid,
          ${observation.voice?.segmentId ?? null}::uuid, ${observation.editDraftId}::uuid,
          ${observation.supersedesObservationId}::uuid, ${observation.supersededByObservationId}::uuid,
          ${observation.createdAt}::timestamptz)
      `);
      if (observation.componentIds.length) {
        await tx.observationComponents.createMany({
          data: observation.componentIds.map((componentId) => ({
            observationId: observation.id,
            componentId,
          })),
        });
      }
      if (observation.evidenceAnchorIds.length) {
        await tx.observationAnchors.createMany({
          data: observation.evidenceAnchorIds.map((anchorId) => ({
            observationId: observation.id,
            anchorId,
          })),
        });
      }
      if (observation.checkIds.length) {
        await tx.checkObservations.createMany({
          data: observation.checkIds.map((checkId) => ({
            observationId: observation.id,
            checkId,
          })),
        });
      }
    },

    async supersedeObservation(id, replacementId) {
      const { count } = await tx.observations.updateMany({
        data: { supersededById: replacementId },
        where: { id, ownerId, supersededById: null },
      });
      if (!count) {
        throw new Error('Observation already superseded or inaccessible');
      }
    },

    async queryObservations(
      recordId,
      cursor,
      limit,
    ): Promise<CursorPage<Observation>> {
      const size = Math.min(limit ?? 50, 100);
      const position = cursor
        ? (JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
            createdAt: string;
            id: string;
          })
        : null;
      const after = position
        ? Prisma.sql`and (created_at < ${position.createdAt}::timestamptz
            or (created_at = ${position.createdAt}::timestamptz and id < ${position.id}::uuid))`
        : Prisma.empty;
      const rows = await tx.$queryRaw<
        Array<{ id: string; createdAt: string }>
      >(Prisma.sql`
        select id, created_at::text as "createdAt" from observations
        where owner_id = ${ownerId} and record_id = ${recordId}::uuid
          and superseded_by_id is null ${after}
        order by created_at desc, id desc limit ${size + 1}
      `);
      const page = rows.slice(0, size);

      return {
        items: (
          await Promise.all(page.map(async (row) => getObservation(row.id)))
        ).filter((item): item is Observation => item !== null),
        nextCursor:
          rows.length > size && page.at(-1)
            ? pageCursor(page.at(-1)!.createdAt, page.at(-1)!.id)
            : null,
      };
    },
    getCheck,

    async findActiveCheck(recordId, methodVersionId, componentIds) {
      const row = await tx.recordChecks.findFirst({
        select: { id: true },
        where: {
          ownerId,
          recordId,
          methodVersionId,
          scopeKey: scopeKey(componentIds),
        },
      });

      return row ? getCheck(row.id) : null;
    },

    async addCheck(check) {
      await tx.$executeRaw(Prisma.sql`
        insert into record_checks (id, owner_id, record_id, method_id, method_version_id, scope_key,
          revision, progress, result_kind, result_reason, suggested_by_run_id, created_at, updated_at)
        values (${check.id}::uuid, ${ownerId}, ${check.recordId}::uuid, ${check.methodId}::uuid,
          ${check.methodVersionId}::uuid, ${scopeKey(check.componentIds)}, ${check.revision}, ${check.progress},
          ${check.result.kind}, ${'reason' in check.result ? check.result.reason : null},
          ${check.suggestedByRunId}::uuid, ${check.createdAt}::timestamptz, ${check.updatedAt}::timestamptz)
      `);
      if (check.componentIds.length) {
        await tx.checkComponents.createMany({
          data: check.componentIds.map((componentId) => ({
            checkId: check.id,
            componentId,
          })),
        });
      }
      if (check.observationIds.length) {
        await tx.checkObservations.createMany({
          data: check.observationIds.map((observationId) => ({
            checkId: check.id,
            observationId,
          })),
        });
      }
      if (check.evidenceAnchorIds.length) {
        await tx.checkAnchors.createMany({
          data: check.evidenceAnchorIds.map((anchorId) => ({
            checkId: check.id,
            anchorId,
          })),
        });
      }
    },

    async updateCheck(check, expectedRevision) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        update record_checks set revision = ${check.revision}, progress = ${check.progress},
          result_kind = ${check.result.kind},
          result_reason = ${'reason' in check.result ? check.result.reason : null},
          updated_at = ${check.updatedAt}::timestamptz
        where id = ${check.id}::uuid and owner_id = ${ownerId} and revision = ${expectedRevision}
        returning id
      `);
      if (!rows.length) {
        return false;
      }
      if (check.observationIds.length) {
        await tx.checkObservations.createMany({
          data: check.observationIds.map((observationId) => ({
            checkId: check.id,
            observationId,
          })),
          skipDuplicates: true,
        });
      }
      if (check.evidenceAnchorIds.length) {
        await tx.checkAnchors.createMany({
          data: check.evidenceAnchorIds.map((anchorId) => ({
            checkId: check.id,
            anchorId,
          })),
          skipDuplicates: true,
        });
      }

      return true;
    },
  };
}
