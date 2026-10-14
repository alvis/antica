import { editDraftResultSchema } from '@antica/contracts';

import type {
  ClockPort,
  EditDraftRunRecord,
  ModelCatalogPort,
  OperationResult,
  RecordEditingPort,
  TransactionPort,
} from '../ports/index.js';

/**
 * creates a worker that saves an edit draft from its frozen record and source text
 * @param transaction provides owner-scoped draft and job updates
 * @param model proposes edits from the frozen input
 * @param catalog resolves the selected structured-output model
 * @param clock timestamps saved results and completed jobs
 * @returns handler for an owner and job ID that reports completion or a typed draft failure
 */
export function createEditDraftHandler(
  transaction: TransactionPort,
  model: RecordEditingPort,
  catalog: ModelCatalogPort,
  clock: ClockPort,
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
    const output = parsed.data;
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
    const ids = new Set<string>();
    const fields = new Set<string>();
    for (const change of output.proposedChanges) {
      if (
        ids.has(change.id) ||
        fields.has(change.field) ||
        !same(change.before, snapshot.fields[change.field])
      ) {
        return failure(
          'VALIDATION_FAILED',
          'Edit proposal changed or duplicated its frozen field',
        );
      }
      ids.add(change.id);
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
