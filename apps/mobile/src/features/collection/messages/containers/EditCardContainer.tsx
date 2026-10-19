import { useAuth } from '../../../../providers/AuthProvider';
import { useLocale } from '../../../../providers/LocaleProvider';

import { EditCard } from '../components/EditCard';
import { useEditCard } from '../hooks/useEditCard';

import type { FC } from 'react';

import type { RecordMessageEntry } from '@antica/contracts';

import type { EditCardState, EditCardUpdate } from '../hooks/useEditCardStates';

/** properties for the edit card of one assistant reply */
export type EditCardContainerProps = {
  recordId: string;
  entry: RecordMessageEntry;
  /** revision of the record the screen currently shows */
  recordRevision: number | undefined;
  /** the card's state, held above the virtualised list */
  state: EditCardState;
  update: EditCardUpdate;
};

/**
 * keeps an assistant reply's per-field choices and settles the decided ones
 * @param props card properties
 * @param props.recordId record the proposals change
 * @param props.entry assistant reply whose draft proposes the changes
 * @param props.recordRevision revision of the shown record
 * @param props.state the card's lifted state
 * @param props.update replaces the card's lifted state
 * @returns the card wired to the apply endpoint
 */
export const EditCardContainer: FC<EditCardContainerProps> = ({
  recordId,
  entry,
  recordRevision,
  state,
  update,
}) => {
  const { api } = useAuth();
  const { t } = useLocale();
  const card = useEditCard({
    api,
    recordId,
    entry,
    recordRevision,
    state,
    update,
    t,
  });
  const { apply } = card;

  return (
    <EditCard
      editDraftId={entry.editDraftId}
      draft={entry.draft}
      decisions={card.decisions}
      decisionCount={card.confirmedIds.length + card.rejectedIds.length}
      applying={card.applying}
      error={card.error}
      onDecide={card.decide}
      onApply={apply && (() => void apply())}
    />
  );
};
