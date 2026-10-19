import { createHash } from 'node:crypto';

import { recordFieldsSchema } from '@antica/contracts';

import { freezeKnowledgeEvidence } from '../knowledge/evidence.js';

import { recordFieldsOf } from '../record/fields.js';

import type {
  EditDraftAccepted,
  EditDraftApplied,
  EditDraftApply,
  EditDraftDetail,
  EditDraftRequest,
  ModelSelection,
  KnowledgeAttachment,
  ProposedChange,
  RecordDetail,
} from '@antica/contracts';

import type { KnowledgeEvidenceReader } from '../knowledge/evidence.js';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  TransactionPort,
  UnitOfWork,
} from '../ports/index.js';

export interface EditDraftService {
  submit(
    ownerId: string,
    input: EditDraftRequest,
  ): Promise<OperationResult<EditDraftAccepted>>;
  get(ownerId: string, id: string): Promise<OperationResult<EditDraftDetail>>;
  /**
   * adopts selected proposals, records skipped ones, and writes one history entry per decided field
   *
   * `input.expectedRecordRevision` is the record revision the collector saw when
   * tapping apply: it rejects a stale screen once (retryable). Each proposal's
   * `before` is the stale-proposal guard: only a selected field that changed
   * since the draft blocks adoption (A7), so unselected and skipped fields may
   * change freely. A reject-only adoption leaves the record and its revision
   * untouched; a proposal already applied or skipped cannot be decided again.
   * @param ownerId authenticated collector
   * @param id edit draft identifier
   * @param input selected and skipped proposals with draft and displayed record revisions
   * @returns applied draft and updated record, or a typed failure
   */
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
 * @param ids creates job, outbox, and history entry identifiers
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
        async (unit) =>
          submitEditDraft(unit, ownerId, input, { selection, clock, ids }),
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
          const fingerprint = digest({ id, input: comparable(input) });
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
          const skippedIds = input.skippedProposalIds ?? [];
          const selected = decidedProposals(
            draft,
            run.detail.result.proposedChanges,
            input,
          );
          if (!Array.isArray(selected)) {
            return selected;
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
          // a reject-only adoption leaves the record and its revision untouched
          const written =
            selected.length === 0
              ? { success: true as const, data: record }
              : await writeSelected(unit, record, {
                  editDraftId: id,
                  fields,
                  selectedProposalIds: input.selectedProposalIds,
                });
          if (!written.success) {
            return written;
          }
          const marked = await unit.editDrafts.markApplied(
            id,
            draft.revision,
            input.selectedProposalIds,
            clock.now(),
            skippedIds,
          );
          if (!marked) {
            return failure(
              'REVISION_CONFLICT',
              'Edit draft changed during adoption',
            );
          }
          for (const change of selected) {
            await unit.editDrafts.appendAdoption(
              id,
              change.id,
              'accepted',
              ids.create(),
            );
          }
          const final = await recordSkips(
            unit,
            id,
            skippedIds.map((proposalId) => ({
              proposalId,
              eventId: ids.create(),
            })),
          );
          if (!final.success) {
            return final;
          }
          const result = { draft: final.data, record: written.data };
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

/** capabilities a draft submission needs besides its transaction */
export interface EditDraftSubmitParams {
  /** model used for the queued draft */
  readonly selection: ModelSelection;
  /** timestamps the draft */
  readonly clock: ClockPort;
  /** creates job and outbox identifiers */
  readonly ids: IdPort;
  /** freeze suggested knowledge evidence for a record message, including an empty selection */
  readonly knowledgeAttachments?: readonly KnowledgeAttachment[];
  /** accept a request whose only input is its instruction, as a typed conversation message is */
  readonly allowInstructionOnly?: boolean;
  /** accept transcriptions that are ready but not yet confirmed, as a spoken conversation message is; their text is frozen as source text and no observation exists */
  readonly allowReadyTranscriptions?: boolean;
}

/**
 * freezes the record and sources, then queues the draft, its job, and its outbox event inside the caller's transaction
 * @param unit owner-scoped repositories of the caller's transaction
 * @param ownerId collector submitting the request
 * @param input frozen edit request, whose request key is also the draft ID
 * @param params model selection, clock, ID source, and whether an instruction alone or ready transcriptions are enough input
 * @param params.selection selected structured-output model
 * @param params.clock submission timestamp source
 * @param params.ids server identifier source
 * @param params.knowledgeAttachments suggested evidence to validate and freeze for messages
 * @param params.allowInstructionOnly whether a message without media may start a draft
 * @param params.allowReadyTranscriptions whether ready voice text may be frozen before confirmation
 * @returns the draft and job IDs, the earlier ones on an identical replay, or a typed failure that rolls the caller's transaction back
 */
export async function submitEditDraft(
  unit: UnitOfWork,
  ownerId: string,
  input: EditDraftRequest,
  {
    selection,
    clock,
    ids,
    knowledgeAttachments,
    allowInstructionOnly = false,
    allowReadyTranscriptions = false,
  }: EditDraftSubmitParams,
): Promise<OperationResult<EditDraftAccepted>> {
  const fingerprint = digest(
    knowledgeAttachments?.length ? { ...input, knowledgeAttachments } : input,
  );
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
    return failure('REVISION_CONFLICT', 'Record changed before edit request');
  }
  if (
    new Set(input.transcriptionIds).size !== input.transcriptionIds.length ||
    new Set(input.observationIds).size !== input.observationIds.length
  ) {
    return failure('VALIDATION_FAILED', 'Source IDs must be distinct');
  }
  const sourceText: Array<EditDraftDetail['snapshot']['sourceText'][number]> =
    [];
  const transcriptionVersions: Array<
    EditDraftDetail['snapshot']['transcriptionVersions'][number]
  > = [];
  for (const id of input.transcriptionIds) {
    const run = await unit.transcriptions.get(id);
    const ready =
      allowReadyTranscriptions &&
      run?.detail.snapshot.recordId === record.id &&
      run.detail.status === 'ready'
        ? run.detail.result
        : null;
    if (run && ready) {
      transcriptionVersions.push({ id, revision: run.detail.revision });
      sourceText.push({
        kind: 'transcription',
        id,
        text: ready.readingTextZhHant || ready.originalText,
      });
      continue;
    }
    if (
      !run ||
      run.detail.snapshot.recordId !== record.id ||
      run.detail.status !== 'confirmed' ||
      !run.detail.confirmedObservationId
    ) {
      return failure(
        'EVIDENCE_INVALID',
        allowReadyTranscriptions
          ? 'Ready transcription does not belong to record'
          : 'Confirmed transcription does not belong to record',
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
  if (
    sourceText.length === 0 &&
    !(allowInstructionOnly && input.instructionZhHant.trim() !== '')
  ) {
    return failure(
      'VALIDATION_FAILED',
      'Select a transcription or observation for the edit',
    );
  }
  const grounded =
    knowledgeAttachments === undefined
      ? undefined
      : await freezeKnowledgeEvidence(
          unit.knowledge as typeof unit.knowledge & KnowledgeEvidenceReader,
          record,
          knowledgeAttachments,
          ids.create(),
        );
  if (grounded && !grounded.success) {
    return grounded;
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
      ...(grounded?.success ? { knowledgeContext: grounded.data } : {}),
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
    skippedProposalIds: [],
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
}

/**
 * writes one skipped history entry per rejected proposal, then reads the draft back with them
 * @param unit owner-scoped repositories of the adoption transaction
 * @param editDraftId draft whose proposals were rejected
 * @param skips rejected proposals, already counted by markApplied, with their history entry identifiers
 * @returns the draft as it now stands, or a typed failure when it can no longer be read
 */
async function recordSkips(
  unit: UnitOfWork,
  editDraftId: string,
  skips: ReadonlyArray<{
    readonly proposalId: string;
    readonly eventId: string;
  }>,
): Promise<OperationResult<EditDraftDetail>> {
  for (const { proposalId, eventId } of skips) {
    await unit.editDrafts.appendAdoption(
      editDraftId,
      proposalId,
      'skipped',
      eventId,
    );
  }
  // markApplied reports the draft before these skips were recorded
  const final = await unit.editDrafts.get(editDraftId);

  return final
    ? { success: true, data: final.detail }
    : failure('REVISION_CONFLICT', 'Edit draft changed during adoption');
}

/**
 * writes the selected proposals to the record at its next revision, linked to the draft
 * @param unit owner-scoped repositories of the adoption transaction
 * @param record record as checked against the displayed revision
 * @param adoption what the adoption writes
 * @param adoption.editDraftId draft the proposals come from
 * @param adoption.fields proposed values keyed by record field
 * @param adoption.selectedProposalIds proposals the values come from
 * @returns the updated record, or a typed failure when the values are invalid or the record moved
 */
async function writeSelected(
  unit: UnitOfWork,
  record: RecordDetail,
  {
    editDraftId,
    fields,
    selectedProposalIds,
  }: {
    readonly editDraftId: string;
    readonly fields: Record<string, unknown>;
    readonly selectedProposalIds: readonly string[];
  },
): Promise<OperationResult<RecordDetail>> {
  const parsed = recordFieldsSchema.partial().safeParse(fields);
  if (!parsed.success) {
    return failure(
      'VALIDATION_FAILED',
      'Selected proposal failed record validation',
    );
  }
  const updated = await unit.records.patch(
    record.id,
    {
      expectedRevision: record.recordRevision,
      fields: parsed.data,
      editDraftId,
      acceptedProposalIds: [...selectedProposalIds],
    },
    {
      recordRevision: record.recordRevision + 1,
      analysisInputVersion: record.analysisInputVersion + 1,
      evidenceVersion: record.evidenceVersion,
    },
  );

  return updated
    ? { success: true, data: updated }
    : failure('REVISION_CONFLICT', 'Record changed during adoption');
}

/**
 * checks that each decided proposal belongs to the draft, is decided once, and is still unresolved
 * @param draft ready or partially applied draft, whose applied and skipped proposals are resolved
 * @param proposals proposals of the draft result
 * @param input selected and skipped proposals of the adoption
 * @returns the selected proposals in draft order, or the typed failure that rejects the adoption
 */
function decidedProposals(
  draft: EditDraftDetail,
  proposals: readonly ProposedChange[],
  input: EditDraftApply,
): ProposedChange[] | OperationResult<never> {
  const skippedIds = input.skippedProposalIds ?? [];
  const decided = [...input.selectedProposalIds, ...skippedIds];
  if (new Set(decided).size !== decided.length) {
    return failure('VALIDATION_FAILED', 'Select or skip each proposal once');
  }
  const known = new Set(proposals.map(({ id }) => id));
  const resolved = new Set([
    ...draft.appliedProposalIds,
    ...draft.skippedProposalIds,
  ]);
  if (decided.some((id) => !known.has(id) || resolved.has(id))) {
    return failure('VALIDATION_FAILED', 'Selected proposal is unavailable');
  }

  return proposals.filter((change) =>
    input.selectedProposalIds.includes(change.id),
  );
}

/**
 * drops an empty skipped list so an adoption fingerprints the same whether the list is omitted or empty
 * @param input adoption as received
 * @returns the adoption in its comparable form, identical to the form fingerprinted before skips existed
 */
function comparable(input: EditDraftApply): EditDraftApply {
  if (input.skippedProposalIds?.length) {
    return input;
  }
  const { skippedProposalIds: _empty, ...rest } = input;

  return rest;
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
