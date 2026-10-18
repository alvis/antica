import type { Transaction } from '../transaction.js';

/**
 * reads the proposals each draft's collector rejected, from their skipped history entries
 * @param tx transaction the drafts are read in
 * @param ownerId collector who owns the drafts
 * @param editDraftIds drafts to look up
 * @returns skipped proposal IDs keyed by draft, in history order; drafts without skips are absent
 */
export async function listSkippedProposalIds(
  tx: Transaction,
  ownerId: string,
  editDraftIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> {
  const skipped = new Map<string, string[]>();
  if (editDraftIds.length === 0) {
    return skipped;
  }
  const rows = await tx.editDraftAdoptionEvents.findMany({
    select: { editDraftId: true, proposalId: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    where: {
      AND: [
        { ownerId },
        { editDraftId: { in: [...editDraftIds] } },
        { status: 'skipped' },
      ],
    },
  });
  for (const { editDraftId, proposalId } of rows) {
    skipped.set(editDraftId, [...(skipped.get(editDraftId) ?? []), proposalId]);
  }

  return skipped;
}

/**
 * orders proposal IDs as the draft result lists them, so one adoption's entries read stably
 * @param result draft result holding the proposals
 * @param proposalIds IDs to order
 * @returns the IDs in proposal order
 */
export function inProposalOrder(
  result: {
    readonly proposedChanges: ReadonlyArray<{ readonly id: string }>;
  } | null,
  proposalIds: readonly string[],
): string[] {
  return (result?.proposedChanges ?? [])
    .map(({ id }) => id)
    .filter((id) => proposalIds.includes(id));
}
