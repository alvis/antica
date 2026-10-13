import { isDeepStrictEqual } from 'node:util';

import { and, eq, inArray, isNull } from 'drizzle-orm';

import { editDraftDetailSchema } from '@antica/contracts';

import { editDraftRuns, jobs, records } from '../schema/index.js';

import type {
  EditDraftRepository,
  EditDraftRunRecord,
} from '@antica/application/ports';
import type { Transaction } from '../transaction.js';

function iso(value: string): string {
  return new Date(value).toISOString();
}

/** Persists frozen edit inputs, first-write proposals, and proposal adoption. */
export function createEditDraftRepository(
  tx: Transaction,
  ownerId: string,
): EditDraftRepository {
  async function get(id: string): Promise<EditDraftRunRecord | null> {
    const [row] = await tx
      .select()
      .from(editDraftRuns)
      .where(and(eq(editDraftRuns.id, id), eq(editDraftRuns.ownerId, ownerId)));
    if (!row) {
      return null;
    }

    return {
      detail: editDraftDetailSchema.parse({
        editDraftId: row.id,
        jobId: row.jobId,
        revision: row.revision,
        status: row.status,
        snapshot: row.snapshot,
        result: row.result,
        invocation: row.invocation,
        appliedProposalIds: row.appliedProposalIds,
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      }),
      request: row.request as EditDraftRunRecord['request'],
      modelSelection:
        row.modelSelection as EditDraftRunRecord['modelSelection'],
    };
  }

  return {
    get,
    /** @param run */
    async create(run) {
      const { detail, request } = run;
      if (
        detail.status !== 'pending' ||
        detail.revision !== 1 ||
        detail.result !== null ||
        detail.invocation !== null ||
        detail.appliedProposalIds.length !== 0 ||
        detail.snapshot.recordId !== request.recordId ||
        detail.snapshot.versions.recordRevision !==
          request.expectedRecordRevision ||
        !isDeepStrictEqual(
          detail.snapshot.transcriptionVersions.map((item) => item.id),
          request.transcriptionIds,
        ) ||
        !isDeepStrictEqual(
          detail.snapshot.observationIds,
          request.observationIds,
        )
      ) {
        throw new Error('Edit draft run input is inconsistent');
      }

      const [[job], [record]] = await Promise.all([
        tx
          .select({ id: jobs.id })
          .from(jobs)
          .where(
            and(
              eq(jobs.id, detail.jobId),
              eq(jobs.ownerId, ownerId),
              eq(jobs.kind, 'recordEditing'),
              eq(jobs.resourceId, detail.editDraftId),
            ),
          ),
        tx
          .select({ id: records.id })
          .from(records)
          .where(
            and(
              eq(records.id, detail.snapshot.recordId),
              eq(records.ownerId, ownerId),
            ),
          ),
      ]);
      if (!job || !record) {
        throw new Error('Edit draft dependencies are inaccessible');
      }

      await tx.insert(editDraftRuns).values({
        id: detail.editDraftId,
        ownerId,
        jobId: detail.jobId,
        recordId: detail.snapshot.recordId,
        revision: detail.revision,
        status: detail.status,
        snapshot: detail.snapshot,
        request,
        modelSelection: run.modelSelection,
        result: null,
        invocation: null,
        appliedProposalIds: [],
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
      });
    },
    /** @param id @param result @param invocation @param expectedRevision @param updatedAt */
    async saveResult(id, result, invocation, expectedRevision, updatedAt) {
      const [run] = await tx
        .select({
          recordId: editDraftRuns.recordId,
          snapshot: editDraftRuns.snapshot,
        })
        .from(editDraftRuns)
        .where(
          and(eq(editDraftRuns.id, id), eq(editDraftRuns.ownerId, ownerId)),
        );
      const snapshot = run?.snapshot as
        EditDraftRunRecord['detail']['snapshot'] | undefined;
      if (
        !run ||
        !snapshot ||
        result.editDraftId !== id ||
        result.recordId !== run.recordId ||
        !isDeepStrictEqual(result.baseVersions, snapshot.versions) ||
        !isDeepStrictEqual(
          result.sourceTranscriptionIds,
          snapshot.transcriptionVersions.map((item) => item.id),
        ) ||
        !isDeepStrictEqual(result.sourceObservationIds, snapshot.observationIds)
      ) {
        return false;
      }
      const [changed] = await tx
        .update(editDraftRuns)
        .set({
          result,
          invocation,
          status: 'ready',
          revision: expectedRevision + 1,
          updatedAt,
        })
        .where(
          and(
            eq(editDraftRuns.id, id),
            eq(editDraftRuns.ownerId, ownerId),
            eq(editDraftRuns.revision, expectedRevision),
            eq(editDraftRuns.status, 'pending'),
            isNull(editDraftRuns.result),
            isNull(editDraftRuns.invocation),
          ),
        )
        .returning({ id: editDraftRuns.id });

      return Boolean(changed);
    },
    /** @param id @param expectedRevision @param selectedProposalIds @param updatedAt */
    async markApplied(id, expectedRevision, selectedProposalIds, updatedAt) {
      if (
        selectedProposalIds.length === 0 ||
        new Set(selectedProposalIds).size !== selectedProposalIds.length
      ) {
        return null;
      }
      const [run] = await tx
        .select({
          result: editDraftRuns.result,
          applied: editDraftRuns.appliedProposalIds,
        })
        .from(editDraftRuns)
        .where(
          and(
            eq(editDraftRuns.id, id),
            eq(editDraftRuns.ownerId, ownerId),
            eq(editDraftRuns.revision, expectedRevision),
            inArray(editDraftRuns.status, ['ready', 'partially_applied']),
          ),
        );
      const result = run?.result as EditDraftRunRecord['detail']['result'];
      const applied = (run?.applied ?? []) as readonly string[];
      const proposalIds = new Set(
        result?.proposedChanges.map((proposal) => proposal.id),
      );
      if (
        !result ||
        selectedProposalIds.some((proposalId) => !proposalIds.has(proposalId))
      ) {
        return null;
      }
      const combined = [...applied];
      for (const proposalId of selectedProposalIds) {
        if (!combined.includes(proposalId)) {
          combined.push(proposalId);
        }
      }
      const status =
        combined.length === proposalIds.size ? 'applied' : 'partially_applied';
      const [changed] = await tx
        .update(editDraftRuns)
        .set({
          appliedProposalIds: combined,
          status,
          revision: expectedRevision + 1,
          updatedAt,
        })
        .where(
          and(
            eq(editDraftRuns.id, id),
            eq(editDraftRuns.ownerId, ownerId),
            eq(editDraftRuns.revision, expectedRevision),
            inArray(editDraftRuns.status, ['ready', 'partially_applied']),
          ),
        )
        .returning({ id: editDraftRuns.id });
      if (!changed) {
        return null;
      }

      return (await get(id))!.detail;
    },
  };
}
