import { createHash } from 'node:crypto';

import type {
  CheckCreate,
  CheckPatch,
  EvidenceCreateRequest,
  EvidenceCreation,
  ObservationInput,
  CursorPage,
} from '@antica/contracts';
import type { EvidenceAnchor, Observation, RecordCheck } from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

/** persistent evidence and collector inspection operations */
export interface EvidenceService {
  createAnchor(
    ownerId: string,
    input: EvidenceCreateRequest,
  ): Promise<OperationResult<EvidenceCreation>>;
  addObservation(
    ownerId: string,
    requestKey: string,
    input: ObservationInput,
  ): Promise<OperationResult<Observation>>;
  observations(
    ownerId: string,
    recordId: string,
    cursor?: string,
    limit?: number,
  ): Promise<OperationResult<CursorPage<Observation>>>;
  createCheck(
    ownerId: string,
    recordId: string,
    requestKey: string,
    input: CheckCreate,
  ): Promise<OperationResult<RecordCheck>>;
  getCheck(
    ownerId: string,
    checkId: string,
  ): Promise<OperationResult<RecordCheck>>;
  updateCheck(
    ownerId: string,
    checkId: string,
    input: CheckPatch,
  ): Promise<OperationResult<RecordCheck>>;
}

/**
 * creates inspection workflows with independent collector observations
 * @param transaction
 * @param clock
 * @param ids
 */
export function createEvidenceService(
  transaction: TransactionPort,
  clock: ClockPort,
  ids: IdPort,
): EvidenceService {
  return {
    createAnchor: async (ownerId, input) =>
      transaction.run(ownerId, async (unit) => {
        const prior = await unit.commands.get(
          ownerId,
          'evidence.create',
          input.requestKey,
        );
        const fingerprint = digest(input);
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as EvidenceCreation }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const record = await unit.records.get(
          input.mode === 'create' ? input.evidence.recordId : input.recordId,
        );
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        if (input.mode === 'prepare_frame') {
          const media = await unit.media.get(input.originalAssetId);
          if (
            !media ||
            media.kind !== 'video' ||
            media.owner.kind !== 'record' ||
            media.owner.recordId !== record.id ||
            media.state !== 'ready'
          ) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Video is unavailable for this record',
                retryable: false,
              },
            };
          }
          const now = clock.now();
          const job = {
            id: ids.create(),
            kind: 'media' as const,
            resourceId: media.id,
            state: { kind: 'queued' as const },
            createdAt: now,
            updatedAt: now,
            result: { requestedTimeMs: input.requestedTimeMs },
          };
          await unit.jobs.create(job);
          await unit.outbox.enqueue({
            id: ids.create(),
            name: 'antica.media.frame_requested',
            event: {
              eventId: ids.create(),
              schemaVersion: '1',
              jobId: job.id,
              resourceId: media.id,
              ownerId,
              idempotencyKey: input.requestKey,
            },
            createdAt: now,
            sentAt: null,
          });
          await unit.commands.insert({
            ownerId,
            operation: 'evidence.create',
            requestKey: input.requestKey,
            fingerprint,
            status: 202,
            result: job,
          });

          return { success: true, data: job };
        }
        const media = await unit.media.get(input.evidence.originalAssetId);
        const view = media?.views.find(
          (candidate) => candidate.id === input.evidence.canonicalViewId,
        );
        if (
          !media ||
          media.state !== 'ready' ||
          media.owner.kind !== 'record' ||
          media.owner.recordId !== record.id ||
          !view
        ) {
          return {
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message: 'Evidence view does not belong to this record',
              retryable: false,
            },
          };
        }
        if (
          input.evidence.kind === 'image' &&
          view.originalCoordinateSpace !== 'image_pixels'
        ) {
          return {
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message: 'Image evidence requires an image view',
              retryable: false,
            },
          };
        }
        if (input.evidence.kind === 'video_frame') {
          const frame = view.derivativeId
            ? await unit.media.getFrameByDerivative(view.derivativeId)
            : null;
          const selected = input.evidence.frame;
          if (
            media.kind !== 'video' ||
            view.originalCoordinateSpace !== 'video_frame_pixels' ||
            view.derivativeId !== selected.frameDerivativeId ||
            !frame ||
            frame.frameDerivativeId !== selected.frameDerivativeId ||
            frame.streamIndex !== selected.streamIndex ||
            frame.pts !== selected.pts ||
            frame.timeBase.numerator !== selected.timeBase.numerator ||
            frame.timeBase.denominator !== selected.timeBase.denominator ||
            frame.displayTimeMs !== selected.displayTimeMs
          ) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Video frame does not match the prepared original',
                retryable: false,
              },
            };
          }
        }
        if (input.checkId) {
          const check = await unit.evidence.getCheck(input.checkId);
          if (!check || check.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Check does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        const anchor: EvidenceAnchor = {
          ...input.evidence,
          id: ids.create(),
          createdAt: clock.now(),
        };
        await unit.evidence.addAnchor(anchor);
        if (
          !(await unit.records.bumpVersions(record.id, record.recordRevision, {
            analysisInput: true,
            evidence: true,
          }))
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during evidence creation',
              retryable: true,
            },
          };
        }
        await unit.commands.insert({
          ownerId,
          operation: 'evidence.create',
          requestKey: input.requestKey,
          fingerprint,
          status: 201,
          result: anchor,
        });

        return { success: true, data: anchor };
      }),
    addObservation: async (ownerId, requestKey, input) =>
      transaction.run(ownerId, async (unit) => {
        const prior = await unit.commands.get(
          ownerId,
          'observations.create',
          requestKey,
        );
        const fingerprint = digest(input);
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as Observation }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const record = await unit.records.get(input.recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        for (const anchorId of input.evidenceAnchorIds) {
          const anchor = await unit.evidence.getAnchor(anchorId);
          if (!anchor || anchor.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Observation evidence does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        for (const checkId of input.checkIds) {
          const check = await unit.evidence.getCheck(checkId);
          if (!check || check.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Observation check does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        if (input.voice) {
          const audio = await unit.media.get(input.voice.audioAssetId);
          if (
            !audio ||
            audio.kind !== 'audio' ||
            audio.owner.kind !== 'record' ||
            audio.owner.recordId !== record.id
          ) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Voice original does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        const observation: Observation = {
          ...input,
          id: ids.create(),
          author: 'collector',
          createdAt: clock.now(),
          supersededByObservationId: null,
        };
        await unit.evidence.addObservation(observation);
        if (input.supersedesObservationId) {
          const previous = await unit.evidence.getObservation(
            input.supersedesObservationId,
          );
          if (!previous || previous.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Prior observation does not belong to this record',
                retryable: false,
              },
            };
          }
          await unit.evidence.supersedeObservation(previous.id, observation.id);
        }
        if (
          !(await unit.records.bumpVersions(record.id, record.recordRevision, {
            analysisInput: true,
            evidence: input.evidenceAnchorIds.length > 0,
          }))
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during observation',
              retryable: true,
            },
          };
        }
        await unit.commands.insert({
          ownerId,
          operation: 'observations.create',
          requestKey,
          fingerprint,
          status: 201,
          result: observation,
        });

        return { success: true, data: observation };
      }),
    observations: async (ownerId, recordId, cursor, limit) =>
      transaction.run(ownerId, async (unit) => {
        if (!(await unit.records.get(recordId))) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }

        return {
          success: true,
          data: await unit.evidence.queryObservations(recordId, cursor, limit),
        };
      }),
    createCheck: async (ownerId, recordId, requestKey, input) =>
      transaction.run(ownerId, async (unit) => {
        const fingerprint = digest({ recordId, input });
        const prior = await unit.commands.get(
          ownerId,
          'checks.create',
          requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as RecordCheck }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const record = await unit.records.get(recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        const componentIds = input.componentIds ?? [];
        const existing = await unit.evidence.findActiveCheck(
          recordId,
          input.methodVersionId,
          componentIds,
        );
        if (existing) {
          return { success: true, data: existing };
        }
        if (record.recordRevision !== input.expectedRecordRevision) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed since inspection began',
              retryable: true,
            },
          };
        }
        if (
          componentIds.some(
            (id) => !record.components.some((component) => component.id === id),
          )
        ) {
          return {
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message: 'Inspection component does not belong to this record',
              retryable: false,
            },
          };
        }
        const methodVersion = await unit.knowledge.getMethodVersion(
          input.methodVersionId,
        );
        if (!methodVersion || methodVersion.methodId !== input.methodId) {
          return {
            success: false,
            error: {
              code: 'EVIDENCE_INVALID',
              message: 'Inspection method version is invalid',
              retryable: false,
            },
          };
        }
        if (input.suggestedByRunId) {
          const run = await unit.analyses.get(input.suggestedByRunId);
          if (
            !run ||
            run.recordId !== recordId ||
            !run.suggestedMethodVersions.some(
              (method) =>
                method.methodId === input.methodId &&
                method.methodVersionId === input.methodVersionId,
            )
          ) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Suggested method version is invalid',
                retryable: false,
              },
            };
          }
        }
        const now = clock.now();
        const check: RecordCheck = {
          id: ids.create(),
          revision: 1,
          createdAt: now,
          updatedAt: now,
          recordId,
          componentIds,
          methodId: input.methodId,
          methodVersionId: input.methodVersionId,
          suggestedByRunId: input.suggestedByRunId ?? null,
          progress: 'not_started',
          result: { kind: 'unrecorded' },
          observationIds: [],
          evidenceAnchorIds: [],
          pendingActionIds: [],
        };
        await unit.evidence.addCheck(check);
        if (
          !(await unit.records.bumpVersions(record.id, record.recordRevision, {
            analysisInput: true,
            evidence: false,
          }))
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during inspection creation',
              retryable: true,
            },
          };
        }
        await unit.commands.insert({
          ownerId,
          operation: 'checks.create',
          requestKey,
          fingerprint,
          status: 201,
          result: check,
        });

        return { success: true, data: check };
      }),
    getCheck: async (ownerId, checkId) =>
      transaction.run(ownerId, async (unit) => {
        const check = await unit.evidence.getCheck(checkId);

        return check
          ? { success: true, data: check }
          : {
              success: false,
              error: {
                code: 'NOT_FOUND',
                message: 'Check not found',
                retryable: false,
              },
            };
      }),
    updateCheck: async (ownerId, checkId, input) =>
      transaction.run(ownerId, async (unit) => {
        const fingerprint = digest({ checkId, input });
        const prior = await unit.commands.get(
          ownerId,
          'checks.update',
          input.requestKey,
        );
        if (prior) {
          return prior.fingerprint === fingerprint
            ? { success: true, data: prior.result as RecordCheck }
            : {
                success: false,
                error: {
                  code: 'VALIDATION_FAILED',
                  message: 'Idempotency key was used for a different request',
                  retryable: false,
                },
              };
        }
        const current = await unit.evidence.getCheck(checkId);
        if (!current) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Check not found',
              retryable: false,
            },
          };
        }
        const record = await unit.records.get(current.recordId);
        if (!record) {
          return {
            success: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Record not found',
              retryable: false,
            },
          };
        }
        if (
          current.revision !== input.expectedRevision ||
          record.recordRevision !== input.expectedRecordRevision
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Inspection or record changed',
              retryable: true,
            },
          };
        }
        if (input.newObservation) {
          return {
            success: false,
            error: {
              code: 'VALIDATION_FAILED',
              message:
                'Create the observation before linking it to an inspection',
              retryable: false,
            },
          };
        }
        for (const anchorId of input.addEvidenceAnchorIds ?? []) {
          const anchor = await unit.evidence.getAnchor(anchorId);
          if (!anchor || anchor.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message: 'Inspection evidence does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        for (const observationId of input.addObservationIds ?? []) {
          const observation = await unit.evidence.getObservation(observationId);
          if (!observation || observation.recordId !== record.id) {
            return {
              success: false,
              error: {
                code: 'EVIDENCE_INVALID',
                message:
                  'Inspection observation does not belong to this record',
                retryable: false,
              },
            };
          }
        }
        const updated: RecordCheck = {
          ...current,
          revision: current.revision + 1,
          updatedAt: clock.now(),
          progress: input.progress ?? current.progress,
          result: input.result ?? current.result,
          observationIds: [
            ...new Set([
              ...current.observationIds,
              ...(input.addObservationIds ?? []),
            ]),
          ],
          evidenceAnchorIds: [
            ...new Set([
              ...current.evidenceAnchorIds,
              ...(input.addEvidenceAnchorIds ?? []),
            ]),
          ],
        };
        if (!(await unit.evidence.updateCheck(updated, current.revision))) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Inspection changed during update',
              retryable: true,
            },
          };
        }
        if (
          !(await unit.records.bumpVersions(record.id, record.recordRevision, {
            analysisInput: true,
            evidence: (input.addEvidenceAnchorIds?.length ?? 0) > 0,
          }))
        ) {
          return {
            success: false,
            error: {
              code: 'REVISION_CONFLICT',
              message: 'Record changed during inspection update',
              retryable: true,
            },
          };
        }
        await unit.commands.insert({
          ownerId,
          operation: 'checks.update',
          requestKey: input.requestKey,
          fingerprint,
          status: 200,
          result: updated,
        });

        return { success: true, data: updated };
      }),
  };
}

/** @param value */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
