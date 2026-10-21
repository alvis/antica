import { useRouter } from 'expo-router';

import { useAuth } from '../../../../providers/AuthProvider';
import { useLocale } from '../../../../providers/LocaleProvider';

import { EditCard } from '../components/EditCard';
import { useEditCard } from '../hooks/useEditCard';

import type { FC } from 'react';

import type { RecordDetail, RecordMessageEntry } from '@antica/contracts';

import type { EditCardState, EditCardUpdate } from '../hooks/useEditCardStates';

/** properties for the edit card of one assistant reply */
export type EditCardContainerProps = {
  recordId: string;
  entry: RecordMessageEntry;
  /** record the screen currently shows */
  record: RecordDetail | undefined;
  /** the card's state, held above the virtualised list */
  state: EditCardState;
  update: EditCardUpdate;
};

/**
 * keeps an assistant reply's per-field choices and settles the decided ones
 * @param props card properties
 * @param props.recordId record the proposals change
 * @param props.entry assistant reply whose draft proposes the changes
 * @param props.record record currently shown
 * @param props.state the card's lifted state
 * @param props.update replaces the card's lifted state
 * @returns the card wired to the apply endpoint
 */
export const EditCardContainer: FC<EditCardContainerProps> = ({
  recordId,
  entry,
  record,
  state,
  update,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const card = useEditCard({
    api,
    recordId,
    entry,
    record,
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
      counts={{
        confirmed: card.confirmedIds.length,
        rejected: card.rejectedIds.length,
        undecided: card.undecidedIds.length,
      }}
      applying={card.applying}
      error={card.error}
      staleIds={card.staleIds}
      onDecide={card.decide}
      onApply={apply && (() => void apply())}
      onOpenHistory={() =>
        router.replace(`/collection/${encodeURIComponent(recordId)}/history`)
      }
    />
  );
};
