import { Text, View } from 'react-native';

import { styles } from '@antica/ui';

import { useLocale } from '../../../../i18n/LocaleProvider';

import { EditCardRow } from './EditCardRow';
import { MessageButton } from './MessageButton';

import type { FC } from 'react';

import type { RecordMessageDraft } from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

import type { ProposalDecision } from '../hooks/useEditCardStates';

import type { ProposalOutcome } from './EditCardRow';

/** properties for the proposed changes of one assistant reply */
export type EditCardProps = {
  editDraftId: string;
  draft: RecordMessageDraft;
  decisions: Readonly<Partial<Record<string, ProposalDecision>>>;
  /** number of confirmed or rejected proposals the apply action would settle */
  decisionCount: number;
  applying: boolean;
  /** inline failure of the last apply attempt */
  error: string;
  onDecide: (proposalId: string, decision: ProposalDecision) => void;
  /** applies the confirmed proposals and skips the rejected ones; absent while nothing is decided */
  onApply?: () => void;
};

/**
 * picks the status line for a card from how far its proposals are settled
 * @param draft draft status with its applied and skipped proposals
 * @returns message key of the status line
 */
function editCardStatusKey(draft: RecordMessageDraft): MessageKey {
  const someSkipped = draft.skippedProposalIds.length > 0;

  switch (draft.status) {
    case 'applied':
      return someSkipped ? 'editCardResolved' : 'editCardApplied';
    case 'partially_applied':
      return draft.appliedProposalIds.length > 0
        ? 'editCardPartlyApplied'
        : 'editCardPartlyDecided';
    default:
      return 'editCardReady';
  }
}

/**
 * tells whether the server already settled a proposal
 * @param draft draft with its applied and skipped proposals
 * @param proposalId proposal to look up
 * @returns the settled outcome, or undefined while the proposal still takes a choice
 */
function outcomeOf(
  draft: RecordMessageDraft,
  proposalId: string,
): ProposalOutcome | undefined {
  if (draft.appliedProposalIds.includes(proposalId)) {
    return 'applied';
  }

  return draft.skippedProposalIds.includes(proposalId) ? 'skipped' : undefined;
}

/**
 * renders an edit card whose fields the collector confirms or rejects one by one
 * @param props card properties
 * @param props.editDraftId draft behind the reply, used for automation identifiers
 * @param props.draft draft status, proposals, and applied and skipped proposals
 * @param props.decisions the collector's choice per proposal
 * @param props.decisionCount number of confirmed or rejected proposals awaiting apply
 * @param props.applying whether an apply is in flight
 * @param props.error inline failure of the last apply
 * @param props.onDecide records a choice for one proposal
 * @param props.onApply applies the decisions, absent while unavailable
 * @returns a card listing each proposed field with its choices and the apply action
 */
export const EditCard: FC<EditCardProps> = ({
  editDraftId,
  draft,
  decisions,
  decisionCount,
  applying,
  error,
  onDecide,
  onApply,
}) => {
  const { t } = useLocale();

  return (
    <View
      testID={`record-message-card-${editDraftId}`}
      style={[styles.card, { alignSelf: 'stretch' }]}>
      <Text accessibilityRole="header" style={styles.label}>
        {t('editCardTitle')}
      </Text>
      <Text
        testID={`record-message-card-status-${editDraftId}`}
        style={styles.secondary}>
        {t(editCardStatusKey(draft))}
      </Text>
      {draft.proposedChanges.map((change) => (
        <EditCardRow
          key={change.id}
          change={change}
          outcome={outcomeOf(draft, change.id)}
          decision={decisions[change.id]}
          onDecide={
            applying ? undefined : (decision) => onDecide(change.id, decision)
          }
        />
      ))}
      {Boolean(error) && (
        <Text
          testID={`record-message-card-error-${editDraftId}`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {error}
        </Text>
      )}
      {draft.status !== 'applied' && (
        <MessageButton
          label={`${t('applyDecisions')} (${decisionCount})`}
          testID={`record-message-card-apply-${editDraftId}`}
          onPress={onApply}
        />
      )}
    </View>
  );
};
