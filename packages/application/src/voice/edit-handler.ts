import {
  editDraftResultSchema,
  knowledgeNoSupportedAnswer,
  recordMessageReplyMaxLength,
} from '@antica/contracts';

import { validateKnowledgeAnswerSegments } from '../knowledge/evidence.js';

import type { EditDraftResult } from '@antica/contracts';

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
    const context = {
      fields: snapshot.fields,
      versions: snapshot.versions,
      ...(snapshot.knowledgeContext
        ? { knowledgeContext: snapshot.knowledgeContext }
        : {}),
    };
    let modeled = await model.draft(
      run.request,
      snapshot.sourceText.map((source) => source.text),
      context,
      run.modelSelection,
    );
    let invocation = modeled.success
      ? modeled.data.invocation
      : modeled.audit.invocation;
    let output: EditDraftResult = {
      editDraftId: run.detail.editDraftId,
      recordId: snapshot.recordId,
      baseVersions: snapshot.versions,
      sourceTranscriptionIds: run.request.transcriptionIds,
      sourceObservationIds: run.request.observationIds,
      suggestedDescriptionZhHant: snapshot.fields.description,
      replyZhHant: knowledgeNoSupportedAnswer,
      answerSegments: [{ text: knowledgeNoSupportedAnswer, evidenceRefs: [] }],
      proposedChanges: [],
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      invocation =
        (modeled.success
          ? modeled.data.invocation
          : modeled.audit.invocation) ?? invocation;
      if (
        !modeled.success &&
        (!snapshot.knowledgeContext ||
          (attempt === 0 && modeled.error.code !== 'MODEL_OUTPUT_INVALID'))
      ) {
        return modeled;
      }
      if (modeled.success) {
        // Parse the existing edit contract separately so malformed references can be repaired.
        const { answerSegments, ...base } = Object(
          modeled.data.value,
        ) as EditDraftResult;
        const parsed = editDraftResultSchema.safeParse(base);
        if (!parsed.success) {
          return failure(
            'VALIDATION_FAILED',
            'Edit model output failed schema validation',
          );
        }
        const candidate = {
          ...parsed.data,
          ...(answerSegments === undefined ? {} : { answerSegments }),
        };
        if (!validFrozenOutput(candidate, run)) {
          return failure(
            'VALIDATION_FAILED',
            'Edit output changed or duplicated its frozen input or field',
          );
        }
        if (
          !snapshot.knowledgeContext ||
          (answerSegments &&
            validateKnowledgeAnswerSegments(
              answerSegments,
              snapshot.knowledgeContext,
            ))
        ) {
          output = candidate;
          break;
        }
        invocation = {
          ...modeled.data.invocation,
          citationCheck: { valid: false, rejectedReferenceIds: [] },
        };
      }
      if (attempt === 0) {
        modeled = await model.draft(
          run.request,
          snapshot.sourceText.map((source) => source.text),
          {
            ...context,
            evidenceRepair:
              'The previous answer contained missing or invalid evidence references. Return answerSegments using only exact entryId, revision, claimKey and citationIds present in knowledgeContext. Preserve applicability and uncertainty. If support is absent, say so with no evidenceRefs. Never invent URLs, locators or edits.',
          },
          run.modelSelection,
        );
      }
    }
    output = {
      ...output,
      replyZhHant: snapshot.knowledgeContext
        ? output.answerSegments!.map((segment) => segment.text).join('\n')
        : capReply(output.replyZhHant),
    };
    const verified = output;
    if (!invocation) {
      return failure(
        'VALIDATION_FAILED',
        'Edit model returned no auditable invocation',
      );
    }
    const savedInvocation = invocation;

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
          verified,
          savedInvocation,
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
          body: verified.replyZhHant.trim() || NEUTRAL_REPLY_ZH_HANT,
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

/**
 * Preserves the existing identity, unique-field and before-value checks on every attempt.
 * @param output parsed edit result, including a repair when requested
 * @param run authoritative frozen edit request
 * @returns whether the output still belongs to this exact draft and fields
 */
function validFrozenOutput(
  output: EditDraftResult,
  run: EditDraftRunRecord,
): boolean {
  const snapshot = run.detail.snapshot;
  if (
    output.editDraftId !== run.detail.editDraftId ||
    output.recordId !== snapshot.recordId ||
    !same(output.baseVersions, snapshot.versions) ||
    !same(output.sourceTranscriptionIds, run.request.transcriptionIds) ||
    !same(output.sourceObservationIds, run.request.observationIds)
  ) {
    return false;
  }
  const ids = new Set<string>();
  const fields = new Set<string>();
  for (const change of output.proposedChanges) {
    if (
      ids.has(change.id) ||
      fields.has(change.field) ||
      !same(change.before, snapshot.fields[change.field])
    ) {
      return false;
    }
    ids.add(change.id);
    fields.add(change.field);
  }

  return true;
}
