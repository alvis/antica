import {
  editDraftResultSchema,
  recordMessageReplyMaxLength,
} from '@antica/contracts';

import type {
  ClockPort,
  EditDraftRunRecord,
  IdPort,
  ModelCatalogPort,
  OperationResult,
  RecordEditingPort,
  TransactionPort,
} from '../ports/index.js';

/** stands in for a model answer without words so that every started conversation gets a reply */
const NEUTRAL_REPLY_ZH_HANT = '已處理你的訊息。';

/**
 * creates a worker that saves an edit draft from its frozen record and source text
 * @param transaction provides owner-scoped draft and job updates
 * @param model proposes edits from the frozen input
 * @param catalog resolves the selected structured-output model
 * @param clock timestamps saved results and completed jobs
 * @param ids creates the identifier of the assistant reply
 * @returns handler for an owner and job ID that reports completion or a typed draft failure; a draft started from a record message also gets its assistant reply in the same transaction as its result
 */
export function createEditDraftHandler(
  transaction: TransactionPort,
  model: RecordEditingPort,
  catalog: ModelCatalogPort,
  clock: ClockPort,
  ids: IdPort,
): (ownerId: string, jobId: string) => Promise<OperationResult<void>> {
  return async (ownerId, jobId) => {
    const prepared = await transaction.run<OperationResult<EditDraftRunRecord>>(
      ownerId,
      async (unit) => {
        const job = await unit.jobs.get(jobId);
        if (!job || job.kind !== 'recordEditing') {
          return failure('NOT_FOUND', 'Edit job not found');
        }
        const run = await unit.editDrafts.get(job.resourceId);

        return run
          ? { success: true, data: run }
          : failure('NOT_FOUND', 'Edit draft not found');
      },
    );
    if (!prepared.success) {
      return prepared;
    }
    const run = prepared.data;
    if (run.detail.result) {
      return { success: true, data: undefined };
    }
    const capability = await catalog.resolve(run.modelSelection, {
      textInput: true,
      structuredOutput: true,
    });
    if (!capability.success) {
      return capability;
    }
    const snapshot = run.detail.snapshot;
    const modeled = await model.draft(
      run.request,
      snapshot.sourceText.map((source) => source.text),
      { fields: snapshot.fields, versions: snapshot.versions },
      run.modelSelection,
    );
    if (!modeled.success) {
      return modeled;
    }
    const parsed = editDraftResultSchema.safeParse(modeled.data.value);
    if (!parsed.success) {
      return failure(
        'VALIDATION_FAILED',
        'Edit model output failed schema validation',
      );
    }
    // the stored result and the reply stay within the cap the app renders
    const output = {
      ...parsed.data,
      replyZhHant: capReply(parsed.data.replyZhHant),
    };
    if (
      output.editDraftId !== run.detail.editDraftId ||
      output.recordId !== snapshot.recordId ||
      !same(output.baseVersions, snapshot.versions) ||
      !same(output.sourceTranscriptionIds, run.request.transcriptionIds) ||
      !same(output.sourceObservationIds, run.request.observationIds)
    ) {
      return failure(
        'VALIDATION_FAILED',
        'Edit output changed its frozen input identity',
      );
    }
    const proposalIds = new Set<string>();
    const fields = new Set<string>();
    for (const change of output.proposedChanges) {
      if (
        proposalIds.has(change.id) ||
        fields.has(change.field) ||
        !same(change.before, snapshot.fields[change.field])
      ) {
        return failure(
          'VALIDATION_FAILED',
          'Edit proposal changed or duplicated its frozen field',
        );
      }
      proposalIds.add(change.id);
      fields.add(change.field);
    }

    return transaction.run<OperationResult<void>>(ownerId, async (unit) => {
      const current = await unit.editDrafts.get(run.detail.editDraftId);
      const job = await unit.jobs.get(jobId);
      if (!current || !job) {
        return failure('NOT_FOUND', 'Edit job disappeared');
      }
      if (current.detail.result) {
        return { success: true, data: undefined };
      }
      const now = clock.now();
      if (
        !(await unit.editDrafts.saveResult(
          current.detail.editDraftId,
          output,
          modeled.data.invocation,
          current.detail.revision,
          now,
        ))
      ) {
        return failure('REVISION_CONFLICT', 'Edit draft changed during save');
      }
      if (
        !(await unit.jobs.update(
          {
            ...job,
            state: { kind: 'succeeded', completedAt: now },
            updatedAt: now,
            result: { editDraftId: current.detail.editDraftId },
          },
          job.updatedAt,
        ))
      ) {
        return failure('REVISION_CONFLICT', 'Edit job changed during save');
      }
      if (
        await unit.recordMessages.findCollectorMessage(
          current.detail.editDraftId,
        )
      ) {
        await unit.recordMessages.insertAssistantReply({
          id: ids.create(),
          recordId: current.detail.snapshot.recordId,
          editDraftId: current.detail.editDraftId,
          body: output.replyZhHant.trim() || NEUTRAL_REPLY_ZH_HANT,
          createdAt: now,
        });
      }

      return { success: true, data: undefined };
    });
  };
}

/**
 * @param left
 * @param right
 */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * @param code
 * @param message
 */
function failure(
  code: 'NOT_FOUND' | 'VALIDATION_FAILED' | 'REVISION_CONFLICT',
  message: string,
): OperationResult<never> {
  return {
    success: false,
    error: { code, message, retryable: code === 'REVISION_CONFLICT' },
  };
}

/**
 * cuts a reply to the length the app stores and shows
 * @param reply text the model wrote
 * @returns the reply, or its first recordMessageReplyMaxLength code units without a half character at the cut
 */
function capReply(reply: string): string {
  const cut = reply.slice(0, recordMessageReplyMaxLength);

  return reply.length > recordMessageReplyMaxLength && !cut.isWellFormed()
    ? cut.slice(0, -1)
    : cut;
}
