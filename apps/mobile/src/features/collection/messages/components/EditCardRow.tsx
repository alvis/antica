import { Pressable, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { FieldValue } from '../../../../components/FieldValue';
import { useKnowledgeTitles } from '../../../../hooks/useKnowledgeTitles';
import { localizeProposalField } from '../../../../i18n/messages';
import { useLocale } from '../../../../providers/LocaleProvider';

import { proposalFieldTestId } from '../../proposal-field-test-id';

import type { FC } from 'react';

import type { ProposedChange } from '@antica/contracts';

import type { FieldDisplayValue } from '../../../../utils/field-value';

import type { ProposalDecision } from '../hooks/useEditCardStates';

/** how the server settled a proposal; an unsettled proposal still takes a choice */
export type ProposalOutcome = 'applied' | 'skipped';

/** properties for one proposed field of an edit card */
export type EditCardRowProps = {
  change: ProposedChange;
  /** whether the proposal is already written to the record or recorded as not applied */
  outcome: ProposalOutcome | undefined;
  decision: ProposalDecision | undefined;
  /** records the collector's choice; absent while the card is applying */
  onDecide?: (decision: ProposalDecision) => void;
};

/**
 * the change's values as the row shows them: a material change names knowledge entries, shown by
 * their titles rather than identifiers
 * @param change proposed field change
 * @returns the previous and proposed values
 */
function useShownValues(change: ProposedChange): {
  before: FieldDisplayValue;
  proposed: FieldDisplayValue;
} {
  const title = useKnowledgeTitles(
    change.field === 'materialIds'
      ? [...change.before, ...change.proposed]
      : [],
  );

  return change.field === 'materialIds'
    ? { before: change.before.map(title), proposed: change.proposed.map(title) }
    : { before: change.before, proposed: change.proposed };
}

/**
 * renders one field's previous and proposed value with its confirm and reject choices
 * @param props row properties
 * @param props.change proposed field change
 * @param props.outcome whether the change is already applied or recorded as not applied
 * @param props.decision the collector's current choice, if any
 * @param props.onDecide records a choice, absent while unavailable
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
  const choices = [
    {
      decision: 'confirmed',
      id: 'confirm',
      label: t('confirmChange'),
      accessibilityLabel: t('confirmField', { field }),
    },
    {
      decision: 'rejected',
      id: 'reject',
      label: t('rejectChange'),
      accessibilityLabel: t('rejectField', { field }),
    },
  ] as const;

  return (
    <View
      testID={`record-message-card-row-${change.id}`}
      style={{
        gap: 8,
        borderTopWidth: 1,
        borderColor: colors.border,
        paddingTop: 12,
      }}>
      <Text style={styles.label}>{field}</Text>
      <FieldValue label={t('previous')} value={shown.before} superseded />
      <FieldValue label={t('proposed')} value={shown.proposed} />
      {outcome === 'applied' ? (
        <Text
          testID={`record-message-card-applied-${fieldId}-${change.id}`}
          // the check mark is decoration; screen readers hear only the status
          accessibilityLabel={t('changeApplied')}
          style={[styles.label, { color: colors.jade }]}>
          ✓ {t('changeApplied')}
        </Text>
      ) : outcome === 'skipped' ? (
        <Text
          testID={`record-message-card-skipped-${fieldId}-${change.id}`}
          // the cross is decoration; screen readers hear only the status
          accessibilityLabel={t('changeSkipped')}
          style={[styles.label, { color: colors.muted }]}>
          ✕ {t('changeSkipped')}
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.row}>
          {choices.map((choice) => {
            const checked = decision === choice.decision;

            return (
              <Pressable
                key={choice.decision}
                testID={`record-message-card-${choice.id}-${fieldId}-${change.id}`}
                accessibilityRole="radio"
                accessibilityLabel={choice.accessibilityLabel}
                accessibilityState={{ checked, disabled: !onDecide }}
                disabled={!onDecide}
                onPress={() => onDecide?.(choice.decision)}
                style={[
                  styles.secondaryButton,
                  { flexGrow: 1, minWidth: 120 },
                  checked && { backgroundColor: colors.jade },
                ]}>
                <Text
                  style={[
                    styles.secondaryButtonText,
                    checked && { color: colors.card },
                  ]}>
                  {checked ? '● ' : '○ '}
                  {choice.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
};
