import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { useKnowledgeTitles } from '../../../../hooks/useKnowledgeTitles';
import { localizeProposalField } from '../../../../i18n/messages';
import { useLocale } from '../../../../providers/LocaleProvider';
import { proposalValueText } from '../../../../utils/proposal-value';

import { proposalFieldTestId } from '../../proposal-field-test-id';

import type { FC } from 'react';

import type { ProposedChange } from '@antica/contracts';

import type { ProposalDecision } from '../hooks/useEditCardStates';

/** how the server settled a proposal; an unsettled proposal still takes a choice */
export type ProposalOutcome = 'applied' | 'skipped';

/** properties for one proposed field of an edit card */
export type EditCardRowProps = {
  change: ProposedChange;
  /** whether the proposal is already written to the record or recorded as not applied */
  outcome: ProposalOutcome | undefined;
  decision: ProposalDecision | undefined;
  /** records the collector's choice, or clears it with undefined; absent while the card is applying */
  onDecide?: (decision: ProposalDecision | undefined) => void;
};

const layout = StyleSheet.create({
  row: {
    paddingTop: theme.space[10],
    paddingBottom: theme.space[12],
    paddingHorizontal: theme.space[16],
    borderBottomWidth: theme.border.hairline.width,
    borderBottomColor: theme.border.hairline.color,
  },
  head: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  field: {
    ...theme.font.face('sans', '600'),
    fontSize: 13,
    lineHeight: 18.2,
    color: theme.color.text.tertiary,
  },
  state: { flexDirection: 'row', alignItems: 'center', gap: theme.space[4] },
  stateText: {
    ...theme.font.face('sans', '600'),
    fontSize: 13,
    lineHeight: 18.2,
  },
  undo: {
    minHeight: theme.size.hitMin,
    marginVertical: -12,
    marginRight: -4,
    paddingLeft: theme.space[10],
    paddingRight: theme.space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
  },
  undoText: {
    ...theme.font.face('sans', '500'),
    fontSize: 13,
    lineHeight: 18.2,
    color: theme.color.text.secondary,
  },
  diff: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    marginTop: theme.space[4],
  },
  before: {
    flexShrink: 1,
    maxWidth: '40%',
    ...theme.font.face('sans', '400'),
    fontSize: 14,
    lineHeight: 22.4,
    color: theme.color.text.tertiary,
    textDecorationLine: 'line-through',
  },
  after: {
    flex: 1,
    paddingVertical: theme.space[2],
    paddingHorizontal: theme.space[6],
    borderRadius: 6,
    backgroundColor: theme.color.accent.soft,
  },
  afterSkipped: { backgroundColor: theme.color.bg.sunken },
  afterText: {
    ...theme.font.face('sans', '700'),
    fontSize: 15,
    lineHeight: 24,
    color: theme.color.accent.onSoft,
  },
  afterTextSkipped: {
    color: theme.color.text.tertiary,
    textDecorationLine: 'line-through',
  },
  buttons: {
    flexDirection: 'row',
    gap: theme.space[8],
    marginTop: theme.space[10],
  },
  button: {
    flex: 1,
    minHeight: theme.size.controlSmall,
    borderRadius: theme.radius.control,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    backgroundColor: theme.color.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: theme.space[16],
  },
  confirm: { borderColor: theme.color.text.primary },
  pressed: { backgroundColor: theme.color.bg.sunken },
  buttonText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    lineHeight: 19.6,
    color: theme.color.text.primary,
  },
});

/**
 * the change's values as the row shows them: a material change names knowledge entries, shown by
 * their titles rather than identifiers
 * @param change proposed field change
 * @returns the previous and proposed values as text
 */
function useShownValues(change: ProposedChange): {
  before: string;
  proposed: string;
} {
  const { t, locale } = useLocale();
  const title = useKnowledgeTitles(
    change.field === 'materialIds' || change.field === 'categoryIds'
      ? [...change.before, ...change.proposed]
      : [],
  );

  return {
    before: proposalValueText(change, change.before, locale, t, title),
    proposed: proposalValueText(change, change.proposed, locale, t, title),
  };
}

/**
 * one row of the edit card (v2 `.erow`): the field, old → new, and 略過 / 確認 until the collector
 * decides; a decided row says so with 復原, and a row the server settled says what happened
 * @param props row properties
 * @param props.change proposed field change
 * @param props.outcome whether the change is already applied or recorded as not applied
 * @param props.decision the collector's current choice, if any
 * @param props.onDecide records or clears a choice, absent while unavailable
 * @returns the proposal row
 */
export const EditCardRow: FC<EditCardRowProps> = ({
  change,
  outcome,
  decision,
  onDecide,
}) => {
  const { t } = useLocale();
  const field = localizeProposalField(change.field, t);
  const shown = useShownValues(change);
  // automation identifiers name the field so flows can pick a row in any language
  const fieldId = proposalFieldTestId(change.field);
  const skipped =
    outcome === 'skipped' || (outcome === undefined && decision === 'rejected');
  const state =
    outcome === 'applied' ? (
      <View
        testID={`record-message-card-applied-${fieldId}-${change.id}`}
        style={layout.state}>
        <Icon name="check" size={18} color={theme.color.accent.default} />
        <Text style={[layout.stateText, { color: theme.color.accent.default }]}>
          {t('editRowWritten')}
        </Text>
      </View>
    ) : outcome === 'skipped' ? (
      <Text
        testID={`record-message-card-skipped-${fieldId}-${change.id}`}
        style={[layout.stateText, { color: theme.color.text.tertiary }]}>
        {t('editRowSkipped')}
      </Text>
    ) : decision ? (
      <View style={layout.state}>
        {decision === 'confirmed' ? (
          <View
            testID={`record-message-card-confirmed-${fieldId}-${change.id}`}
            style={layout.state}>
            <Icon name="check" size={18} color={theme.color.accent.default} />
            <Text
              style={[layout.stateText, { color: theme.color.accent.default }]}>
              {t('editRowConfirmed')}
            </Text>
          </View>
        ) : (
          <Text
            testID={`record-message-card-rejected-${fieldId}-${change.id}`}
            style={[layout.stateText, { color: theme.color.text.tertiary }]}>
            {t('editRowSkipped')}
          </Text>
        )}
        <Pressable
          testID={`record-message-card-undo-${fieldId}-${change.id}`}
          accessibilityRole="button"
          accessibilityLabel={t('editRowUndoLabel', { field })}
          disabled={!onDecide}
          onPress={() => onDecide?.(undefined)}
          style={layout.undo}>
          <Icon name="undo" size={16} color={theme.color.text.secondary} />
          <Text style={layout.undoText}>{t('editRowUndo')}</Text>
        </Pressable>
      </View>
    ) : null;

  return (
    <View
      testID={`record-message-card-row-${change.id}`}
      accessible={false}
      style={layout.row}>
      <View style={layout.head}>
        <Text style={layout.field}>{field}</Text>
        {state}
      </View>
      <View
        accessible
        accessibilityLabel={t('editRowChange', {
          field,
          before: shown.before,
          after: shown.proposed,
        })}
        style={layout.diff}>
        <Text style={layout.before}>{shown.before}</Text>
        <Icon name="arrow" size={18} color={theme.color.text.tertiary} />
        <View style={[layout.after, skipped && layout.afterSkipped]}>
          <Text style={[layout.afterText, skipped && layout.afterTextSkipped]}>
            {shown.proposed}
          </Text>
        </View>
      </View>
      {outcome === undefined && decision === undefined && (
        <View style={layout.buttons}>
          <Pressable
            testID={`record-message-card-reject-${fieldId}-${change.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('rejectField', { field })}
            accessibilityState={{ disabled: !onDecide }}
            disabled={!onDecide}
            onPress={() => onDecide?.('rejected')}
            style={({ pressed }) => [layout.button, pressed && layout.pressed]}>
            <Text style={layout.buttonText}>{t('editRowSkip')}</Text>
          </Pressable>
          <Pressable
            testID={`record-message-card-confirm-${fieldId}-${change.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('confirmField', { field })}
            accessibilityState={{ disabled: !onDecide }}
            disabled={!onDecide}
            onPress={() => onDecide?.('confirmed')}
            style={({ pressed }) => [
              layout.button,
              layout.confirm,
              pressed && layout.pressed,
            ]}>
            <Text style={layout.buttonText}>{t('editRowConfirm')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
};
