import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Icon, theme } from '@antica/ui';

import { localizeProposalField } from '../../../../i18n/messages';
import { useLocale } from '../../../../providers/LocaleProvider';

import { EditCardRow } from './EditCardRow';

import type { FC } from 'react';

import type { RecordMessageDraft } from '@antica/contracts';

import type { ProposalDecision } from '../hooks/useEditCardStates';

import type { ProposalOutcome } from './EditCardRow';

/** properties for the proposed changes of one assistant reply */
export type EditCardProps = {
  editDraftId: string;
  draft: RecordMessageDraft;
  decisions: Readonly<Partial<Record<string, ProposalDecision>>>;
  /** confirmed, rejected and undecided proposals not yet settled */
  counts: { confirmed: number; rejected: number; undecided: number };
  applying: boolean;
  /** inline failure of the last apply attempt */
  error: string;
  /** open rows whose current field values differ from their proposal's before values */
  staleIds: readonly string[];
  onDecide: (
    proposalId: string,
    decision: ProposalDecision | undefined,
  ) => void;
  /** writes the confirmed proposals and skips the rejected ones; absent until every row is decided */
  onApply?: () => void;
  /** opens the record's change history */
  onOpenHistory: () => void;
};

/** how far a card's proposals are settled */
type EditCardState =
  'ready' | 'partly-applied' | 'partly-decided' | 'applied' | 'resolved';

const layout = StyleSheet.create({
  card: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderRadius: theme.radius.card,
    borderWidth: theme.border.hairline.width,
    borderColor: theme.border.hairline.color,
    backgroundColor: theme.color.bg.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space[8],
    paddingVertical: theme.space[12],
    paddingHorizontal: theme.space[16],
    borderBottomWidth: theme.border.hairline.width,
    borderBottomColor: theme.border.hairline.color,
  },
  title: {
    ...theme.font.face('sans', '600'),
    fontSize: 15,
    lineHeight: 21,
    color: theme.color.text.primary,
  },
  meta: {
    ...theme.font.face('sans', '500'),
    fontSize: 13,
    lineHeight: 19.5,
    color: theme.color.text.tertiary,
  },
  foot: {
    paddingTop: theme.space[12],
    paddingHorizontal: theme.space[16],
    paddingBottom: theme.space[16],
    gap: theme.space[8],
  },
  summary: {
    ...theme.type.small,
    color: theme.color.text.tertiary,
    textAlign: 'center',
  },
  written: { flexDirection: 'row', alignItems: 'center', gap: theme.space[6] },
  writtenText: {
    ...theme.font.face('sans', '600'),
    fontSize: 15,
    lineHeight: 24,
    color: theme.color.accent.default,
  },
  link: {
    minHeight: theme.size.hitMin,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
  },
  linkText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    lineHeight: 19.6,
    color: theme.color.accent.default,
  },
  error: { ...theme.type.body2, color: theme.color.status.danger },
});

/**
 * tells how far a card's proposals are settled
 * @param draft draft status with its applied and skipped proposals
 * @returns the card state
 */
function editCardState(draft: RecordMessageDraft): EditCardState {
  const someSkipped = draft.skippedProposalIds.length > 0;

  switch (draft.status) {
    case 'applied':
      return someSkipped ? 'resolved' : 'applied';
    case 'partially_applied':
      return draft.appliedProposalIds.length > 0
        ? 'partly-applied'
        : 'partly-decided';
    default:
      return 'ready';
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
 * the v2 edit card: 修改建議 · N 項 with one row per field, each confirmed or skipped on its own;
 * the write button stays blocked until every row is decided, then writes only the confirmed rows
 * @param props card properties
 * @param props.editDraftId draft behind the reply, used for automation identifiers
 * @param props.draft draft status, proposals, and applied and skipped proposals
 * @param props.decisions the collector's choice per proposal
 * @param props.counts confirmed, rejected and undecided proposals awaiting the write
 * @param props.applying whether a write is in flight
 * @param props.error inline failure of the last write
 * @param props.onDecide records or clears a choice for one proposal
 * @param props.onApply writes the decisions, absent while unavailable
 * @param props.onOpenHistory opens the change history
 * @returns the card
 */
export const EditCard: FC<EditCardProps> = ({
  editDraftId,
  draft,
  decisions,
  counts,
  applying,
  error,
  staleIds,
  onDecide,
  onApply,
  onOpenHistory,
}) => {
  const { t } = useLocale();
  const state = editCardState(draft);
  const settled = draft.status === 'applied';
  const appliedFields = draft.proposedChanges
    .filter((change) => draft.appliedProposalIds.includes(change.id))
    .map((change) => localizeProposalField(change.field, t));
  const label =
    counts.undecided > 0
      ? t('editCardUndecided', { count: counts.undecided })
      : counts.confirmed > 0
        ? t('editCardWrite', { count: counts.confirmed })
        : t('editCardSkipAll');

  return (
    <View testID={`record-message-card-${editDraftId}`} style={layout.card}>
      <View style={layout.head}>
        <Text accessibilityRole="header" style={layout.title}>
          {t('editCardHeading', { count: draft.proposedChanges.length })}
        </Text>
        <Text
          testID={`record-message-card-status-${state}-${editDraftId}`}
          style={layout.meta}>
          {t(settled ? 'editCardSettled' : 'editCardEachRow')}
        </Text>
      </View>
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
      <View style={layout.foot}>
        {staleIds.length > 0 && (
          <Text
            testID={`record-message-card-stale-${editDraftId}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={layout.error}>
            {draft.proposedChanges
              .filter((change) => staleIds.includes(change.id))
              .map((change) => localizeProposalField(change.field, t))
              .join(t('listSeparator'))}
            {'：'}
            {t('staleSuggestionReason')}
          </Text>
        )}
        {Boolean(error) && (
          <Text
            testID={`record-message-card-error-${editDraftId}`}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={layout.error}>
            {error}
          </Text>
        )}
        {settled ? (
          <>
            <View style={layout.written}>
              <Icon name="check" size={18} color={theme.color.accent.default} />
              <Text style={layout.writtenText}>
                {appliedFields.length > 0
                  ? t('editCardWritten', {
                      fields: appliedFields.join(t('listSeparator')),
                    })
                  : t('editCardNothingWritten')}
              </Text>
            </View>
            <Pressable
              testID={`record-message-card-history-${editDraftId}`}
              accessibilityRole="link"
              onPress={onOpenHistory}
              style={layout.link}>
              <Text style={layout.linkText}>{t('editCardViewHistory')}</Text>
              <Icon
                name="chevron"
                size={18}
                color={theme.color.accent.default}
              />
            </Pressable>
          </>
        ) : (
          <>
            <ActionButton
              testID={`record-message-card-apply-${editDraftId}`}
              label={label}
              loading={applying}
              disabled={!onApply}
              onPress={() => onApply?.()}
            />
            <Text accessibilityLiveRegion="polite" style={layout.summary}>
              {counts.undecided > 0
                ? t('editCardSummaryPending', {
                    confirmed: counts.confirmed,
                    rejected: counts.rejected,
                    undecided: counts.undecided,
                  })
                : t('editCardSummary', {
                    confirmed: counts.confirmed,
                    rejected: counts.rejected,
                  })}
            </Text>
          </>
        )}
      </View>
    </View>
  );
};
