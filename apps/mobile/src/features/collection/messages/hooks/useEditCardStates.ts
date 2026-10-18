import { useState } from 'react';

import type { EditDraftApply } from '@antica/contracts';

/** the collector's choice for one proposed field; an absent choice means undecided */
export type ProposalDecision = 'confirmed' | 'rejected';

/** everything an edit card remembers between renders of its list cell */
export interface EditCardState {
  decisions: Readonly<Partial<Record<string, ProposalDecision>>>;
  /** apply request kept so an interrupted apply repeats under the same key */
  request: EditDraftApply | null;
  applying: boolean;
  error: string;
}

/** replaces one card's state from its current value */
export type EditCardUpdate = (
  change: (current: EditCardState) => EditCardState,
) => void;

/** card states of a conversation, keyed by the edit draft behind each card */
export interface EditCardStates {
  stateOf: (editDraftId: string) => EditCardState;
  updaterOf: (editDraftId: string) => EditCardUpdate;
}

const initialCardState: EditCardState = {
  decisions: {},
  request: null,
  applying: false,
  error: '',
};

/**
 * holds every edit card's choices and apply progress above the virtualised list, so scrolling never loses them
 * @returns readers and updaters of each card's state
 */
export function useEditCardStates(): EditCardStates {
  const [states, setStates] = useState<
    Readonly<Partial<Record<string, EditCardState>>>
  >({});

  return {
    stateOf: (editDraftId) => states[editDraftId] ?? initialCardState,
    updaterOf: (editDraftId) => (change) =>
      setStates((current) => ({
        ...current,
        [editDraftId]: change(current[editDraftId] ?? initialCardState),
      })),
  };
}
