import { createHash } from 'node:crypto';

import { recordFieldsSchema } from '@antica/contracts';

import { recordFieldsOf } from '../record/fields.js';

import type {
  EditDraftAccepted,
  EditDraftApplied,
  EditDraftApply,
  EditDraftDetail,
  EditDraftRequest,
  ModelSelection,
} from '@antica/contracts';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
} from '../ports/index.js';

export interface EditDraftService {
  submit(
    ownerId: string,
    input: EditDraftRequest,
  ): Promise<OperationResult<EditDraftAccepted>>;
  get(ownerId: string, id: string): Promise<OperationResult<EditDraftDetail>>;
  apply(
    ownerId: string,
    id: string,
    input: EditDraftApply,
  ): Promise<OperationResult<EditDraftApplied>>;
}

/**
 * creates commands for frozen edit requests and selective proposal adoption
 * @param transaction provides owner-scoped records, drafts, jobs, and receipts
 * @param selection identifies the model used for queued drafts
 * @param clock timestamps draft and adoption changes
 * @param ids creates job and outbox identifiers
 * @returns service that submits drafts, reads results, and applies selected proposals with typed outcomes
 */
export function createEditDraftService(
  transaction: TransactionPort,
  selection: ModelSelection,
  clock: ClockPort,
  ids: IdPort,
): EditDraftService {
  return {
    submit: async (ownerId, input) =>
      transaction.run<OperationResult<EditDraftAccepted>>(
        ownerId,
        async (unit) => {
          const fingerprint = digest(input);
          const prior = await unit.commands.get(
            ownerId,
            'editDrafts.submit',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as EditDraftAccepted }
              : failure(
                  'VALIDATION_FAILED',
                  'Request key was reused for a different edit draft',
                );
          }
          const record = await unit.records.get(input.recordId);
          if (!record) {
            return failure('NOT_FOUND', 'Record not found');
          }
          if (record.recordRevision !== input.expectedRecordRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed before edit request',
            );
          }
          if (
            new Set(input.transcriptionIds).size !==
              input.transcriptionIds.length ||
            new Set(input.observationIds).size !== input.observationIds.length
          ) {
            return failure('VALIDATION_FAILED', 'Source IDs must be distinct');
          }
          const sourceText: Array<
            EditDraftDetail['snapshot']['sourceText'][number]
          > = [];
          const transcriptionVersions: Array<
            EditDraftDetail['snapshot']['transcriptionVersions'][number]
          > = [];
          for (const id of input.transcriptionIds) {
            const run = await unit.transcriptions.get(id);
            if (
              !run ||
              run.detail.snapshot.recordId !== record.id ||
              run.detail.status !== 'confirmed' ||
              !run.detail.confirmedObservationId
            ) {
              return failure(
                'EVIDENCE_INVALID',
                'Confirmed transcription does not belong to record',
              );
            }
            const observation = await unit.evidence.getObservation(
              run.detail.confirmedObservationId,
            );
            if (!observation || observation.recordId !== record.id) {
              return failure(
                'EVIDENCE_INVALID',
                'Confirmed voice observation is unavailable',
              );
            }
            transcriptionVersions.push({ id, revision: run.detail.revision });
            sourceText.push({
              kind: 'transcription',
              id,
              text: observation.text,
            });
          }
          for (const id of input.observationIds) {
            const observation = await unit.evidence.getObservation(id);
            if (!observation || observation.recordId !== record.id) {
              return failure(
                'EVIDENCE_INVALID',
                'Observation does not belong to record',
              );
            }
            sourceText.push({
              kind: 'observation',
              id,
              text: observation.text,
            });
          }
          if (sourceText.length === 0) {
            return failure(
              'VALIDATION_FAILED',
              'Select a transcription or observation for the edit',
            );
          }
          const now = clock.now();
          const editDraftId = input.requestKey;
          const jobId = ids.create();
          const detail: EditDraftDetail = {
            editDraftId,
            jobId,
            revision: 1,
            status: 'pending',
            snapshot: {
              recordId: record.id,
              versions: {
                recordRevision: record.recordRevision,
                analysisInputVersion: record.analysisInputVersion,
                evidenceVersion: record.evidenceVersion,
              },
              fields: recordFieldsOf(record),
              transcriptionVersions,
              observationIds: input.observationIds,
              sourceText,
              createdAt: now,
            },
            result: null,
            invocation: null,
            appliedProposalIds: [],
            createdAt: now,
            updatedAt: now,
          };
          await unit.jobs.create({
            id: jobId,
            kind: 'recordEditing',
            resourceId: editDraftId,
            state: { kind: 'queued' },
            createdAt: now,
            updatedAt: now,
            result: null,
          });
          await unit.editDrafts.create({
            detail,
            request: input,
            modelSelection: selection,
          });
          await unit.outbox.enqueue({
            id: ids.create(),
            name: 'antica.record_editing.requested',
            event: {
              eventId: ids.create(),
              schemaVersion: '1',
              jobId,
              resourceId: editDraftId,
              ownerId,
              idempotencyKey: input.requestKey,
            },
            createdAt: now,
            sentAt: null,
          });
          const accepted = { editDraftId, jobId };
          await unit.commands.insert({
            ownerId,
            operation: 'editDrafts.submit',
            requestKey: input.requestKey,
            fingerprint,
            status: 202,
            result: accepted,
          });

          return { success: true, data: accepted };
        },
      ),
    get: async (ownerId, id) =>
      transaction.run<OperationResult<EditDraftDetail>>(
        ownerId,
        async (unit) => {
          const run = await unit.editDrafts.get(id);

          return run
            ? { success: true, data: run.detail }
            : failure('NOT_FOUND', 'Edit draft not found');
        },
      ),
    apply: async (ownerId, id, input) =>
      transaction.run<OperationResult<EditDraftApplied>>(
        ownerId,
        async (unit) => {
          const fingerprint = digest({ id, input });
          const prior = await unit.commands.get(
            ownerId,
            'editDrafts.apply',
            input.requestKey,
          );
          if (prior) {
            return prior.fingerprint === fingerprint
              ? { success: true, data: prior.result as EditDraftApplied }
              : failure(
                  'VALIDATION_FAILED',
                  'Request key was reused for a different adoption',
                );
          }
          const run = await unit.editDrafts.get(id);
          if (
            !run?.detail.result ||
            (run.detail.status !== 'ready' &&
              run.detail.status !== 'partially_applied')
          ) {
            return failure('NOT_FOUND', 'Ready edit draft not found');
          }
          const draft = run.detail;
          if (draft.revision !== input.expectedDraftRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Edit draft changed before adoption',
            );
          }
          const record = await unit.records.get(draft.snapshot.recordId);
          if (!record) {
            return failure('NOT_FOUND', 'Record not found');
          }
          if (record.recordRevision !== input.expectedRecordRevision) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed before adoption',
            );
          }
          if (
            new Set(input.selectedProposalIds).size !==
            input.selectedProposalIds.length
          ) {
            return failure('VALIDATION_FAILED', 'Select each proposal once');
          }
          const selected = run.detail.result.proposedChanges.filter((change) =>
            input.selectedProposalIds.includes(change.id),
          );
          if (
            selected.length !== input.selectedProposalIds.length ||
            selected.some((change) =>
              draft.appliedProposalIds.includes(change.id),
            )
          ) {
            return failure(
              'VALIDATION_FAILED',
              'Selected proposal is unavailable',
            );
          }
          const fields: Record<string, unknown> = {};
          for (const change of selected) {
            if (Object.hasOwn(fields, change.field)) {
              return failure(
                'VALIDATION_FAILED',
                'Select only one change per field',
              );
            }
            if (digest(record[change.field]) !== digest(change.before)) {
              return failure(
                'REVISION_CONFLICT',
                'Proposed field changed since draft',
              );
            }
            fields[change.field] = change.proposed;
          }
          const parsed = recordFieldsSchema.partial().safeParse(fields);
          if (!parsed.success) {
            return failure(
              'VALIDATION_FAILED',
              'Selected proposal failed record validation',
            );
          }
          const versions = {
            recordRevision: record.recordRevision + 1,
            analysisInputVersion: record.analysisInputVersion + 1,
            evidenceVersion: record.evidenceVersion,
          };
          const updated = await unit.records.patch(
            record.id,
            {
              expectedRevision: record.recordRevision,
              fields: parsed.data,
              editDraftId: id,
              acceptedProposalIds: input.selectedProposalIds,
            },
            versions,
          );
          if (!updated) {
            return failure(
              'REVISION_CONFLICT',
              'Record changed during adoption',
            );
          }
          const next = await unit.editDrafts.markApplied(
            id,
            draft.revision,
            input.selectedProposalIds,
            clock.now(),
          );
          if (!next) {
            return failure(
              'REVISION_CONFLICT',
              'Edit draft changed during adoption',
            );
          }
          const result = { draft: next, record: updated };
          await unit.commands.insert({
            ownerId,
            operation: 'editDrafts.apply',
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
