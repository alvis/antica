import { useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { editDraftApplySchema } from '@antica/contracts';

import { recordQuery } from '../../api/record-query';

import {
  describeMessageError,
  isRevisionConflict,
} from '../api/message-errors';
import {
  applyRecordMessageDraft,
  recordMessagesKey,
} from '../api/record-messages';

import type { ApiTransport } from '@antica/client';
import type { RecordMessageEntry } from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

import type {
  EditCardState,
  EditCardUpdate,
  ProposalDecision,
} from './useEditCardStates';

/** per-field choices on an edit card and the action that settles the decided ones */
export interface EditCard {
  decisions: EditCardState['decisions'];
  /** sets a field's choice, or clears it when the same choice is made again */
  decide: (proposalId: string, decision: ProposalDecision) => void;
  /** proposals confirmed and not yet settled */
  confirmedIds: string[];
  /** proposals rejected and not yet settled */
  rejectedIds: string[];
  applying: boolean;
  error: string;
  /** applies the confirmed proposals and skips the rejected ones; absent while none is decided or the record is not shown */
  apply?: () => Promise<void>;
}

/** what an edit card needs from the conversation around it */
export interface EditCardOptions {
  api: ApiTransport;
  recordId: string;
  /** assistant reply whose draft proposes the changes */
  entry: RecordMessageEntry;
  /** revision of the record the screen currently shows */
  recordRevision: number | undefined;
  /** the card's state, held by the conversation so it survives list virtualisation */
  state: EditCardState;
  update: EditCardUpdate;
  t: (key: MessageKey) => string;
}

/**
 * keeps the collector's per-field choices, applies the confirmed proposals, and records the rejected ones as skipped
 * @param options API transport, the reply's draft, the shown record revision, the card state, and translations
 * @param options.api authenticated API transport
 * @param options.recordId record the proposals change
 * @param options.entry assistant reply whose draft proposes the changes
 * @param options.recordRevision revision of the record the screen currently shows
 * @param options.state the card's lifted state
 * @param options.update replaces the card's lifted state
 * @param options.t translation function for message keys
 * @returns choices, the confirmed and rejected proposals, and the apply action
 */
export function useEditCard({
  api,
  recordId,
  entry,
  recordRevision,
  state,
  update,
  t,
}: EditCardOptions): EditCard {
  const queryClient = useQueryClient();
  const { draft } = entry;
  // proposals the server already settled take no further choice
  const openIds = draft.proposedChanges
    .map((change) => change.id)
    .filter(
      (id) =>
        !draft.appliedProposalIds.includes(id) &&
        !draft.skippedProposalIds.includes(id),
    );
  const confirmedIds = openIds.filter(
    (id) => state.decisions[id] === 'confirmed',
  );
  const rejectedIds = openIds.filter(
    (id) => state.decisions[id] === 'rejected',
  );

  const decide = (proposalId: string, decision: ProposalDecision): void => {
    update((current) => ({
      ...current,
      request: null,
      error: '',
      decisions: {
        ...current.decisions,
        [proposalId]:
          current.decisions[proposalId] === decision ? undefined : decision,
      },
    }));
  };

  const apply = async (revision: number): Promise<void> => {
    const request =
      state.request ??
      editDraftApplySchema.parse({
        requestKey: randomUUID(),
        expectedDraftRevision: draft.revision,
        expectedRecordRevision: revision,
        selectedProposalIds: confirmedIds,
        skippedProposalIds: rejectedIds,
      });
    update((current) => ({ ...current, request, applying: true, error: '' }));
    // a reject-only apply that succeeds leaves the record untouched
    let recordUnchanged = false;
    try {
      await applyRecordMessageDraft(api, entry.editDraftId, request);
      recordUnchanged = request.selectedProposalIds.length === 0;
      update((current) => ({ ...current, request: null, decisions: {} }));
    } catch (cause) {
      // a stale request can never succeed; any other failure retries under the same key
      const stale = isRevisionConflict(cause);
      update((current) => ({
        ...current,
        request: stale ? null : request,
        error: describeMessageError(cause, t, {
          REVISION_CONFLICT: 'changeStale',
        }),
      }));
    } finally {
      await Promise.all(
        [
          ...(recordUnchanged
            ? []
            : [recordQuery(api, recordId).queryKey, ['records']]),
          recordMessagesKey(recordId),
        ].map(async (queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      update((current) => ({ ...current, applying: false }));
    }
  };

  return {
    decisions: state.decisions,
    decide,
    confirmedIds,
    rejectedIds,
    applying: state.applying,
    error: state.error,
    apply:
      recordRevision !== undefined &&
      confirmedIds.length + rejectedIds.length > 0 &&
      !state.applying
        ? async () => apply(recordRevision)
        : undefined,
  };
}
