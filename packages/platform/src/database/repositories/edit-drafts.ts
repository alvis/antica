import { isDeepStrictEqual } from 'node:util';

import { editDraftDetailSchema } from '@antica/contracts';

import { Prisma } from '../generated/client.js';
import { jsonValue, nullableJson } from '../json.js';

import { inProposalOrder, listSkippedProposalIds } from './edit-draft-skips.js';

import type {
  EditDraftRepository,
  EditDraftRunRecord,
} from '@antica/application/ports';

import type { Transaction } from '../transaction.js';

/** @param value */
function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

/**
 * persists frozen edit inputs, first-write proposals, and proposal adoption
 * @param tx
 * @param ownerId
 */
export function createEditDraftRepository(
  tx: Transaction,
  ownerId: string,
): EditDraftRepository {
  async function get(id: string): Promise<EditDraftRunRecord | null> {
    const [row] = await tx.editDraftRuns.findMany({
      where: { AND: [{ id }, { ownerId }] },
    });
    if (!row) {
      return null;
    }
    const skipped = await listSkippedProposalIds(tx, ownerId, [row.id]);

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
        skippedProposalIds: inProposalOrder(
          row.result as EditDraftRunRecord['detail']['result'],
          skipped.get(row.id) ?? [],
        ),
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
        detail.skippedProposalIds.length !== 0 ||
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
        tx.jobs.findMany({
          select: { id: true },
          where: {
            AND: [
              { id: detail.jobId },
              { ownerId },
              { kind: 'recordEditing' },
              { resourceId: detail.editDraftId },
            ],
          },
        }),
        tx.records.findMany({
          select: { id: true },
          where: { AND: [{ id: detail.snapshot.recordId }, { ownerId }] },
        }),
      ]);
      if (!job || !record) {
        throw new Error('Edit draft dependencies are inaccessible');
      }

      await tx.editDraftRuns.createMany({
        data: {
          id: detail.editDraftId,
          ownerId,
          jobId: detail.jobId,
          recordId: detail.snapshot.recordId,
          revision: detail.revision,
          status: detail.status,
          snapshot: jsonValue(detail.snapshot),
          ...(detail.snapshot.knowledgeContext
            ? { knowledgeContext: jsonValue(detail.snapshot.knowledgeContext) }
            : {}),
          request: jsonValue(request),
          modelSelection: jsonValue(run.modelSelection),
          result: nullableJson(null),
          invocation: nullableJson(null),
          appliedProposalIds: jsonValue([]),
          createdAt: detail.createdAt,
          updatedAt: detail.updatedAt,
        },
      });
    },
    /**
     * @param id
     * @param result
     * @param invocation
     * @param expectedRevision
     * @param updatedAt
     */
    async saveResult(id, result, invocation, expectedRevision, updatedAt) {
      const [run] = await tx.editDraftRuns.findMany({
        select: { recordId: true, snapshot: true },
        where: { AND: [{ id }, { ownerId }] },
      });
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
      const [changed] = await tx.editDraftRuns.updateManyAndReturn({
        data: {
          result: nullableJson(result),
          invocation: nullableJson(invocation),
          status: 'ready',
          revision: expectedRevision + 1,
          updatedAt,
        },
        select: { id: true },
        where: {
          AND: [
            { id },
            { ownerId },
            { revision: expectedRevision },
            { status: 'pending' },
            { result: { equals: Prisma.DbNull } },
            { invocation: { equals: Prisma.DbNull } },
          ],
        },
      });

      return Boolean(changed);
    },
    /**
     * @param id
     * @param expectedRevision
     * @param selectedProposalIds
     * @param updatedAt
     * @param skippedProposalIds
     */
    async markApplied(
      id,
      expectedRevision,
      selectedProposalIds,
      updatedAt,
      skippedProposalIds = [],
    ) {
      const decided = [...selectedProposalIds, ...skippedProposalIds];
      if (decided.length === 0 || new Set(decided).size !== decided.length) {
        return null;
      }
      const [run] = await tx.editDraftRuns
        .findMany({
          select: { result: true, appliedProposalIds: true },
          where: {
            AND: [
              { id },
              { ownerId },
              { revision: expectedRevision },
              { status: { in: ['ready', 'partially_applied'] } },
            ],
          },
        })
        .then((rows) =>
          rows.map((row) => ({
            result: row.result,
            applied: row.appliedProposalIds,
          })),
        );
      const result = run?.result as EditDraftRunRecord['detail']['result'];
      const applied = (run?.applied ?? []) as readonly string[];
      const skipped =
        (await listSkippedProposalIds(tx, ownerId, [id])).get(id) ?? [];
      const proposalIds = new Set(
        result?.proposedChanges.map((proposal) => proposal.id),
      );
      if (
        !result ||
        decided.some((proposalId) => !proposalIds.has(proposalId)) ||
        decided.some((proposalId) => skipped.includes(proposalId)) ||
        skippedProposalIds.some((proposalId) => applied.includes(proposalId))
      ) {
        return null;
      }
      const combined = [...applied];
      for (const proposalId of selectedProposalIds) {
        if (!combined.includes(proposalId)) {
          combined.push(proposalId);
        }
      }
      // skipped proposals resolve the draft as much as applied ones do
      const resolved =
        combined.length + skipped.length + skippedProposalIds.length;
      const status =
        resolved === proposalIds.size ? 'applied' : 'partially_applied';
      const [changed] = await tx.editDraftRuns.updateManyAndReturn({
        data: {
          appliedProposalIds: jsonValue(combined),
          status,
          revision: expectedRevision + 1,
          updatedAt,
        },
        select: { id: true },
        where: {
          AND: [
            { id },
            { ownerId },
            { revision: expectedRevision },
            { status: { in: ['ready', 'partially_applied'] } },
          ],
        },
      });
      if (!changed) {
        return null;
      }

      return (await get(id))!.detail;
    },
    /**
     * stores one adopted or skipped proposal with its values at the record's current revision
     * @param id edit draft identifier
     * @param proposalId proposal within the draft result
     * @param status collector decision, which must match the draft's applied set; a proposal is recorded once
     * @param eventId history entry identifier
     */
    async appendAdoption(id, proposalId, status, eventId) {
      const draft = (await get(id))?.detail;
      const proposal = draft?.result?.proposedChanges.find(
        (change) => change.id === proposalId,
      );
      if (
        !draft ||
        !proposal ||
        draft.appliedProposalIds.includes(proposalId) !==
          (status === 'accepted') ||
        draft.skippedProposalIds.includes(proposalId)
      ) {
        throw new Error('Edit draft proposal is not available for history');
      }
      const [record] = await tx.records
        .findMany({
          select: { recordRevision: true },
          where: { AND: [{ id: draft.snapshot.recordId }, { ownerId }] },
        })
        .then((rows) => rows.map((row) => ({ revision: row.recordRevision })));
      if (!record) {
        throw new Error('Record not found');
      }
      await tx.editDraftAdoptionEvents.createMany({
        data: {
          id: eventId,
          ownerId,
          editDraftId: id,
          recordId: draft.snapshot.recordId,
          proposalId,
          field: proposal.field,
          before: jsonValue(proposal.before),
          after: jsonValue(proposal.proposed),
          status,
          recordRevision: record.revision,
        },
      });
    },
  };
}
