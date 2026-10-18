import { Pressable, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { useLocale } from '../../../../i18n/LocaleProvider';
import { localizeProposalField } from '../../../../i18n/messages';

import type { FC } from 'react';

import type { ProposedChange } from '@antica/contracts';

import type { MessageKey } from '../../../../i18n/messages';

import type { ProposalDecision } from '../hooks/useEditCardStates';

/** properties for one proposed field of an edit card */
export type EditCardRowProps = {
  change: ProposedChange;
  /** whether the proposal is already written to the record */
  applied: boolean;
  decision: ProposalDecision | undefined;
  /** records the collector's choice; absent while the card is applying */
  onDecide?: (decision: ProposalDecision) => void;
};

/**
 * formats a proposed field value for reading
 * @param value field value before or after the change
 * @param t translation function for message keys
 * @returns readable text, or the translated empty marker
 */
export function formatProposalValue(
  value: ProposedChange['before'],
  t: (key: MessageKey) => string,
): string {
  const text = Array.isArray(value)
    ? value.join(', ')
    : typeof value === 'object' && value !== null
      ? [
          value.label,
          [value.fromYear, value.toYear]
            .filter((year) => year !== undefined)
            .join('–'),
        ]
          .filter(Boolean)
          .join(' · ')
      : (value ?? '');

  return text.trim() === '' ? t('noValue') : text;
}

/**
 * renders one field's previous and proposed value with its confirm and reject choices
 * @param props row properties
 * @param props.change proposed field change
 * @param props.applied whether the change is already applied
 * @param props.decision the collector's current choice, if any
 * @param props.onDecide records a choice, absent while unavailable
 * @returns the proposal row
 */
export const EditCardRow: FC<EditCardRowProps> = ({
  change,
  applied,
  decision,
  onDecide,
}) => {
  const { t } = useLocale();
  const field = localizeProposalField(change.field, t);
  const choices = [
    { decision: 'confirmed', label: t('confirmChange') },
    { decision: 'rejected', label: t('rejectChange') },
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
      <View style={{ gap: 2 }}>
        <Text style={styles.secondary}>{t('previous')}</Text>
        <Text
          style={[
            styles.body,
            { color: colors.muted, textDecorationLine: 'line-through' },
          ]}>
          {formatProposalValue(change.before, t)}
        </Text>
      </View>
      <View style={{ gap: 2 }}>
        <Text style={styles.secondary}>{t('proposed')}</Text>
        <Text style={styles.body}>
          {formatProposalValue(change.proposed, t)}
        </Text>
      </View>
      {applied ? (
        <Text
          testID={`record-message-card-applied-${change.id}`}
          // the check mark is decoration; screen readers hear only the status
          accessibilityLabel={t('changeApplied')}
          style={[styles.label, { color: colors.jade }]}>
          ✓ {t('changeApplied')}
        </Text>
      ) : (
        <View accessibilityRole="radiogroup" style={styles.row}>
          {choices.map((choice) => {
            const checked = decision === choice.decision;

            return (
              <Pressable
                key={choice.decision}
                testID={`record-message-card-${choice.decision === 'confirmed' ? 'confirm' : 'reject'}-${change.id}`}
                accessibilityRole="radio"
                accessibilityLabel={`${choice.label}: ${field}`}
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
