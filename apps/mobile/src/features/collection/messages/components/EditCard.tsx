import { Text, View } from 'react-native';

import { styles } from '@antica/ui';

import { useLocale } from '../../../../i18n/LocaleProvider';

import { EditCardRow } from './EditCardRow';
import { MessageButton } from './MessageButton';

import type { FC } from 'react';

import type { RecordMessageDraft } from '@antica/contracts';

import type { ProposalDecision } from '../hooks/useEditCardStates';

/** properties for the proposed changes of one assistant reply */
export type EditCardProps = {
  editDraftId: string;
  draft: RecordMessageDraft;
  decisions: Readonly<Partial<Record<string, ProposalDecision>>>;
  /** number of confirmed proposals the apply action would write */
  confirmedCount: number;
  applying: boolean;
  /** inline failure of the last apply attempt */
  error: string;
  onDecide: (proposalId: string, decision: ProposalDecision) => void;
  /** applies the confirmed proposals; absent while nothing can be applied */
  onApply?: () => void;
};

const statusKeys = {
  pending: 'editCardReady',
  ready: 'editCardReady',
  failed: 'editCardReady',
  partially_applied: 'editCardPartlyApplied',
  applied: 'editCardApplied',
} as const;

/**
 * renders an edit card whose fields the collector confirms or rejects one by one
 * @param props card properties
 * @param props.editDraftId draft behind the reply, used for automation identifiers
 * @param props.draft draft status, proposals, and applied proposals
 * @param props.decisions the collector's choice per proposal
 * @param props.confirmedCount number of confirmed proposals awaiting apply
 * @param props.applying whether an apply is in flight
 * @param props.error inline failure of the last apply
 * @param props.onDecide records a choice for one proposal
 * @param props.onApply applies the confirmed proposals, absent while unavailable
 * @returns a card listing each proposed field with its choices and the apply action
 */
export const EditCard: FC<EditCardProps> = ({
  editDraftId,
  draft,
  decisions,
  confirmedCount,
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
        {t(statusKeys[draft.status])}
      </Text>
      {draft.proposedChanges.map((change) => (
        <EditCardRow
          key={change.id}
          change={change}
          applied={draft.appliedProposalIds.includes(change.id)}
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
          label={`${t('applySelected')} (${confirmedCount})`}
          testID={`record-message-card-apply-${editDraftId}`}
          onPress={onApply}
        />
      )}
    </View>
  );
};
