import { createHash } from 'node:crypto';

import type {
  ModelSelection,
  Observation,
  TranscriptionAccepted,
  TranscriptionConfirm,
  TranscriptionConfirmed,
  TranscriptionDetail,
  TranscriptionSubmit,
} from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

export interface TranscriptionService {
  submit(
    ownerId: string,
    input: TranscriptionSubmit,
  ): Promise<OperationResult<TranscriptionAccepted>>;
  get(
    ownerId: string,
    id: string,
  ): Promise<OperationResult<TranscriptionDetail>>;
  confirm(
    ownerId: string,
    id: string,
    input: TranscriptionConfirm,
  ): Promise<OperationResult<TranscriptionConfirmed>>;
}

/**
 * Creates explicit transcription and collector confirmation commands.
 * @param transaction
 * @param selection
 * @param clock
 * @param ids
 */
export function createTranscriptionService(
  transaction: TransactionPort,
  selection: ModelSelection,
  clock: ClockPort,
  ids: IdPort,
): TranscriptionService {
  return {
    submit: async (ownerId, input) =>
      transaction.run<OperationResult<TranscriptionAccepted>>(
        ownerId,
        async (unit) => {
          const fingerprint = digest(input);
          const prior = await unit.commands.get(
            ownerId,
            'transcriptions.submit',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as TranscriptionAccepted }
              : failure(
                  'VALIDATION_FAILED',
                  'Request key was reused for different transcription',
                );
          }
          const record = await unit.records.get(input.recordId);
          if (!record) {
            return failure('NOT_FOUND', 'Record not found');
          }
          if (record.recordRevision !== input.expectedRecordRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed before transcription request',
            );
          }
          const audio = await unit.media.get(input.audioAssetId);
          if (
            !audio ||
            audio.owner.kind !== 'record' ||
            audio.owner.recordId !== record.id ||
            audio.kind !== 'audio' ||
            audio.state !== 'ready'
          ) {
            return failure(
              'EVIDENCE_INVALID',
              'Ready audio is required for this record',
            );
          }
          const now = clock.now();
          const transcriptionId = input.requestKey;
          const jobId = ids.create();
          const detail: TranscriptionDetail = {
            transcriptionId,
            jobId,
            revision: 1,
            status: 'pending',
            snapshot: {
              recordId: record.id,
              recordRevision: record.recordRevision,
              audioAssetId: audio.id,
              audioSha256: audio.sha256,
              createdAt: now,
            },
            result: null,
            invocation: null,
            confirmedObservationId: null,
            createdAt: now,
            updatedAt: now,
          };
          await unit.jobs.create({
            id: jobId,
            kind: 'transcription',
            resourceId: transcriptionId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.transcriptions.create({
            detail,
            request: input,
            modelSelection: selection,
          });
          await unit.outbox.enqueue({
            id: ids.create(),
            name: 'antica.transcription.requested',
            event: {
              eventId: ids.create(),
              schemaVersion: '1',
              jobId,
              resourceId: transcriptionId,
              ownerId,
              idempotencyKey: input.requestKey,
            },
            createdAt: now,
            sentAt: null,
          });
          const accepted = { transcriptionId, jobId };
          await unit.commands.insert({
            ownerId,
            operation: 'transcriptions.submit',
            requestKey: input.requestKey,
            fingerprint,
            status: 202,
            result: accepted,
          });

          return { success: true, data: accepted };
        },
      ),
    get: async (ownerId, id) =>
      transaction.run<OperationResult<TranscriptionDetail>>(
        ownerId,
        async (unit) => {
          const run = await unit.transcriptions.get(id);

          return run
            ? { success: true, data: run.detail }
            : failure('NOT_FOUND', 'Transcription not found');
        },
      ),
    confirm: async (ownerId, id, input) =>
      transaction.run<OperationResult<TranscriptionConfirmed>>(
        ownerId,
        async (unit) => {
          const fingerprint = digest({ id, input });
          const prior = await unit.commands.get(
            ownerId,
            'transcriptions.confirm',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as TranscriptionConfirmed }
              : failure(
                  'VALIDATION_FAILED',
                  'Request key was reused for different confirmation',
                );
          }
          const run = await unit.transcriptions.get(id);
          if (!run || run.detail.status !== 'ready' || !run.detail.result) {
            return failure('NOT_FOUND', 'Ready transcription not found');
          }
          const detail = run.detail;
          if (detail.revision !== input.expectedRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Transcription changed before confirmation',
            );
          }
          const record = await unit.records.get(detail.snapshot.recordId);
          if (!record) {
            return failure('NOT_FOUND', 'Record not found');
          }
          if (record.recordRevision !== input.expectedRecordRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed before confirmation',
            );
          }
          if (
            input.componentIds.some(
              (componentId) =>
                !record.components.some(
                  (component) => component.id === componentId,
                ),
            )
          ) {
            return failure(
              'EVIDENCE_INVALID',
              'Voice component does not belong to this record',
            );
          }
          for (const anchorId of input.evidenceAnchorIds) {
            const anchor = await unit.evidence.getAnchor(anchorId);
            if (!anchor || anchor.recordId !== record.id) {
              return failure(
                'EVIDENCE_INVALID',
                'Voice evidence does not belong to this record',
              );
            }
          }
          for (const checkId of input.checkIds) {
            const check = await unit.evidence.getCheck(checkId);
            if (!check || check.recordId !== record.id) {
              return failure(
                'EVIDENCE_INVALID',
                'Voice check does not belong to this record',
              );
            }
          }
          const now = clock.now();
          const observation: Observation = {
            id: ids.create(),
            recordId: record.id,
            componentIds: input.componentIds,
            channel: 'voice',
            text: input.adoptedTextZhHant,
            evidenceAnchorIds: input.evidenceAnchorIds,
            checkIds: input.checkIds,
            observedAt: input.observedAt,
            voice: {
              audioAssetId: detail.snapshot.audioAssetId,
              transcriptionId: id,
              segmentId: null,
            },
            editDraftId: null,
            supersedesObservationId: null,
            supersededByObservationId: null,
            author: 'collector',
            createdAt: now,
          };
          await unit.evidence.addObservation(observation);
          const versions = await unit.records.bumpVersions(
            record.id,
            record.recordRevision,
            {
              analysisInput: true,
              evidence: input.evidenceAnchorIds.length > 0,
            },
          );
          if (!versions) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed during confirmation',
            );
          }
          const confirmed = await unit.transcriptions.confirm(
            id,
            detail.revision,
            observation.id,
            now,
          );
          if (!confirmed) {
            return failure(
              'REVISION_CONFLICT',
              'Transcription changed during confirmation',
            );
          }
          const result = { transcription: confirmed, observation, versions };
          await unit.commands.insert({
            ownerId,
            operation: 'transcriptions.confirm',
            requestKey: input.requestKey,
            fingerprint,
            status: 200,
            result,
          });

          return { success: true, data: result };
        },
      ),
  };
}

/** @param value */
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/**
 * @param code
 * @param message
 */
function failure(
  code:
    | 'NOT_FOUND'
    | 'VALIDATION_FAILED'
    | 'REVISION_CONFLICT'
    | 'EVIDENCE_INVALID',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}
