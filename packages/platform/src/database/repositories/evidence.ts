import { and, desc, eq, isNull, lt, or } from 'drizzle-orm';
import type { EvidenceRepository } from '@antica/application/ports';
import type { CursorPage } from '@antica/contracts';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';
import type { Transaction } from '../transaction.js';
import {
  anchorComponents,
  checkAnchors,
  checkComponents,
  checkObservations,
  evidenceAnchors,
  observationAnchors,
  observationComponents,
  observations,
  recordChecks,
} from '../schema/index.js';

function scopeKey(componentIds: readonly string[]): string {
  return [...new Set(componentIds)].sort().join(',');
}

function pageCursor(createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt, id })).toString('base64url');
}

function iso(instant: string): string {
  return new Date(instant).toISOString();
}

/**
 * binds evidence, collector observations and pinned checks to one owner
 */
export function createEvidenceRepository(
  tx: Transaction,
  ownerId: string,
): EvidenceRepository {
  async function getAnchor(id: string): Promise<EvidenceAnchor | null> {
    const [row] = await tx
      .select()
      .from(evidenceAnchors)
      .where(
        and(eq(evidenceAnchors.id, id), eq(evidenceAnchors.ownerId, ownerId)),
      );
    if (!row) {
      return null;
    }
    const components = await tx
      .select({ id: anchorComponents.componentId })
      .from(anchorComponents)
      .where(eq(anchorComponents.anchorId, id));
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
    const [row] = await tx
      .select()
      .from(observations)
      .where(and(eq(observations.id, id), eq(observations.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const [components, anchors, checks] = await Promise.all([
      tx
        .select({ id: observationComponents.componentId })
        .from(observationComponents)
        .where(eq(observationComponents.observationId, id)),
      tx
        .select({ id: observationAnchors.anchorId })
        .from(observationAnchors)
        .where(eq(observationAnchors.observationId, id)),
      tx
        .select({ id: checkObservations.checkId })
        .from(checkObservations)
        .where(eq(checkObservations.observationId, id)),
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
    const [row] = await tx
      .select()
      .from(recordChecks)
      .where(and(eq(recordChecks.id, id), eq(recordChecks.ownerId, ownerId)));
    if (!row) {
      return null;
    }
    const [components, observationIds, anchorIds] = await Promise.all([
      tx
        .select({ id: checkComponents.componentId })
        .from(checkComponents)
        .where(eq(checkComponents.checkId, id)),
      tx
        .select({ id: checkObservations.observationId })
        .from(checkObservations)
        .where(eq(checkObservations.checkId, id)),
      tx
        .select({ id: checkAnchors.anchorId })
        .from(checkAnchors)
        .where(eq(checkAnchors.checkId, id)),
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
      const rows = await tx
        .select({ id: evidenceAnchors.id })
        .from(evidenceAnchors)
        .where(
          and(
            eq(evidenceAnchors.ownerId, ownerId),
            eq(evidenceAnchors.originalAssetId, assetId),
          ),
        );
      return (await Promise.all(rows.map((row) => getAnchor(row.id)))).filter(
        (item): item is EvidenceAnchor => item !== null,
      );
    },
    async addAnchor(anchor) {
      await tx.insert(evidenceAnchors).values({
        id: anchor.id,
        ownerId,
        recordId: anchor.recordId,
        originalAssetId: anchor.originalAssetId,
        canonicalViewId: anchor.canonicalViewId,
        kind: anchor.kind,
        scopeKind: anchor.scope.kind,
        region: anchor.scope.kind === 'region' ? anchor.scope.region : null,
        cropDerivativeId:
          anchor.scope.kind === 'region' ? anchor.scope.cropDerivativeId : null,
        frameStreamIndex:
          anchor.kind === 'video_frame' ? anchor.frame.streamIndex : null,
        frameTimebaseNumerator:
          anchor.kind === 'video_frame'
            ? anchor.frame.timeBase.numerator
            : null,
        frameTimebaseDenominator:
          anchor.kind === 'video_frame'
            ? anchor.frame.timeBase.denominator
            : null,
        framePts: anchor.kind === 'video_frame' ? anchor.frame.pts : null,
        frameDerivativeId:
          anchor.kind === 'video_frame' ? anchor.frame.frameDerivativeId : null,
        frameDisplayTimeMs:
          anchor.kind === 'video_frame' ? anchor.frame.displayTimeMs : null,
        createdAt: anchor.createdAt,
      });
      if (anchor.componentIds.length) {
        await tx.insert(anchorComponents).values(
          anchor.componentIds.map((componentId) => ({
            anchorId: anchor.id,
            componentId,
          })),
        );
      }
    },
    getObservation,
    async addObservation(observation) {
      await tx.insert(observations).values({
        id: observation.id,
        ownerId,
        recordId: observation.recordId,
        channel: observation.channel,
        text: observation.text,
        observedAt: observation.observedAt,
        audioAssetId: observation.voice?.audioAssetId,
        transcriptionId: observation.voice?.transcriptionId,
        segmentId: observation.voice?.segmentId,
        editDraftId: observation.editDraftId,
        supersedesId: observation.supersedesObservationId,
        supersededById: observation.supersededByObservationId,
        createdAt: observation.createdAt,
      });
      if (observation.componentIds.length) {
        await tx.insert(observationComponents).values(
          observation.componentIds.map((componentId) => ({
            observationId: observation.id,
            componentId,
          })),
        );
      }
      if (observation.evidenceAnchorIds.length) {
        await tx.insert(observationAnchors).values(
          observation.evidenceAnchorIds.map((anchorId) => ({
            observationId: observation.id,
            anchorId,
          })),
        );
      }
      if (observation.checkIds.length) {
        await tx.insert(checkObservations).values(
          observation.checkIds.map((checkId) => ({
            observationId: observation.id,
            checkId,
          })),
        );
      }
    },
    async supersedeObservation(id, replacementId) {
      const [row] = await tx
        .update(observations)
        .set({ supersededById: replacementId })
        .where(
          and(
            eq(observations.id, id),
            eq(observations.ownerId, ownerId),
            isNull(observations.supersededById),
          ),
        )
        .returning({ id: observations.id });
      if (!row) {
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
      const rows = await tx
        .select({ id: observations.id, createdAt: observations.createdAt })
        .from(observations)
        .where(
          and(
            eq(observations.ownerId, ownerId),
            eq(observations.recordId, recordId),
            isNull(observations.supersededById),
            position
              ? or(
                  lt(observations.createdAt, position.createdAt),
                  and(
                    eq(observations.createdAt, position.createdAt),
                    lt(observations.id, position.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(desc(observations.createdAt), desc(observations.id))
        .limit(size + 1);
      const page = rows.slice(0, size);
      return {
        items: (
          await Promise.all(page.map((row) => getObservation(row.id)))
        ).filter((item): item is Observation => item !== null),
        nextCursor:
          rows.length > size && page.at(-1)
            ? pageCursor(page.at(-1)!.createdAt, page.at(-1)!.id)
            : null,
      };
    },
    getCheck,
    async findActiveCheck(recordId, methodVersionId, componentIds) {
      const [row] = await tx
        .select({ id: recordChecks.id })
        .from(recordChecks)
        .where(
          and(
            eq(recordChecks.ownerId, ownerId),
            eq(recordChecks.recordId, recordId),
            eq(recordChecks.methodVersionId, methodVersionId),
            eq(recordChecks.scopeKey, scopeKey(componentIds)),
          ),
        );
      return row ? getCheck(row.id) : null;
    },
    async addCheck(check) {
      await tx.insert(recordChecks).values({
        id: check.id,
        ownerId,
        recordId: check.recordId,
        methodId: check.methodId,
        methodVersionId: check.methodVersionId,
        scopeKey: scopeKey(check.componentIds),
        revision: check.revision,
        progress: check.progress,
        resultKind: check.result.kind,
        resultReason: 'reason' in check.result ? check.result.reason : null,
        suggestedByRunId: check.suggestedByRunId,
        createdAt: check.createdAt,
        updatedAt: check.updatedAt,
      });
      if (check.componentIds.length) {
        await tx.insert(checkComponents).values(
          check.componentIds.map((componentId) => ({
            checkId: check.id,
            componentId,
          })),
        );
      }
      if (check.observationIds.length) {
        await tx.insert(checkObservations).values(
          check.observationIds.map((observationId) => ({
            checkId: check.id,
            observationId,
          })),
        );
      }
      if (check.evidenceAnchorIds.length) {
        await tx.insert(checkAnchors).values(
          check.evidenceAnchorIds.map((anchorId) => ({
            checkId: check.id,
            anchorId,
          })),
        );
      }
    },
    async updateCheck(check, expectedRevision) {
      const [row] = await tx
        .update(recordChecks)
        .set({
          revision: check.revision,
          progress: check.progress,
          resultKind: check.result.kind,
          resultReason: 'reason' in check.result ? check.result.reason : null,
          updatedAt: check.updatedAt,
        })
        .where(
          and(
            eq(recordChecks.id, check.id),
            eq(recordChecks.ownerId, ownerId),
            eq(recordChecks.revision, expectedRevision),
          ),
        )
        .returning({ id: recordChecks.id });
      if (!row) {
        return false;
      }
      if (check.observationIds.length) {
        await tx
          .insert(checkObservations)
          .values(
            check.observationIds.map((observationId) => ({
              checkId: check.id,
              observationId,
            })),
          )
          .onConflictDoNothing();
      }
      if (check.evidenceAnchorIds.length) {
        await tx
          .insert(checkAnchors)
          .values(
            check.evidenceAnchorIds.map((anchorId) => ({
              checkId: check.id,
              anchorId,
            })),
          )
          .onConflictDoNothing();
      }
      return true;
    },
  };
}
