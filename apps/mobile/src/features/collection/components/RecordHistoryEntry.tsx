import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { localizeProposalField, localizeStatus } from '../../../i18n/messages';

import { proposalFieldTestId } from '../proposal-field-test-id';

import type { FC } from 'react';

import type { RecordHistoryEntry as HistoryEntry } from '@antica/contracts';

import type {
  Locale,
  PlainMessageKey,
  Translate,
} from '../../../i18n/messages';

/** properties for one adopted or skipped suggestion in a record's history */
export type RecordHistoryEntryProps = {
  entry: HistoryEntry;
  locale: Locale;
  t: Translate;
  /** opens the suggestion behind the change; absent when it cannot be opened */
  onOpenSource?: () => void;
};

const periodStatusKeys = {
  collectorClaim: 'periodCollectorClaim',
  unconfirmed: 'periodUnconfirmed',
} as const satisfies Record<string, PlainMessageKey>;

/**
 * renders a field value from a history entry as readable text
 * @param value the before or after value of any record field
 * @param locale active interface locale, which decides the list separator
 * @param t translation function for message keys
 * @returns the value, or a localized placeholder when it is empty
 */
export function formatHistoryValue(
  value: HistoryEntry['before'],
  locale: Locale,
  t: Translate,
): string {
  if (
    value === null ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  ) {
    return t('noValue');
  }
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.join(locale === 'en' ? ', ' : '、');
  }
  const period =
    value.fromYear === undefined && value.toYear === undefined
      ? value.label
      : t('periodWithYears', {
          label: value.label,
          from: value.fromYear ?? t('unknownYear'),
          to: value.toYear ?? t('unknownYear'),
        });

  // the status is shown so a change of status alone is visible
  return t('periodWithStatus', {
    period,
    status: t(periodStatusKeys[value.status]),
  });
}

/**
 * formats when a change was decided in the collector's language
 * @param occurredAt ISO instant of the decision
 * @param locale active interface locale
 * @returns localized date and time
 */
export function formatHistoryTime(occurredAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Date.parse(occurredAt));
}

/**
 * shows which field changed, its values before and after, the decision, when it was made, and its source
 * @param props entry properties
 * @param props.entry adopted or skipped suggestion
 * @param props.locale active interface locale for the time and list separator
 * @param props.t translation function for message keys
 * @param props.onOpenSource opens the suggestion when it can be shown
 * @returns the history entry card
 */
export const RecordHistoryEntry: FC<RecordHistoryEntryProps> = ({
  entry,
  locale,
  t,
  onOpenSource,
}) => {
  const field = localizeProposalField(entry.field, t);
  const heading = t('historyHeading', {
    field,
    status: localizeStatus(entry.status, t),
  });
  const fieldId = proposalFieldTestId(entry.field);
  const time = formatHistoryTime(entry.occurredAt, locale);
  const before = formatHistoryValue(entry.before, locale, t);
  const after = formatHistoryValue(entry.after, locale, t);
  const source = t(
    entry.source.kind === 'analysis'
      ? 'fromAnalysis'
      : 'editedByVoiceOrMessage',
  );

  return (
    <View testID={`record-history-entry-${entry.id}`} style={styles.card}>
      {/* one screen-reader stop for the change; the source action stays separate */}
      <View
        accessible
        testID={`record-history-entry-${entry.id}-${fieldId}-${entry.status}`}
        accessibilityLabel={t('historyEntrySummary', {
          heading,
          time,
          before,
          after,
          source,
        })}
        style={{ gap: 12 }}>
        <Text style={styles.heading}>{heading}</Text>
        <Text style={styles.secondary}>{time}</Text>
        <Text style={styles.label}>{t('changeBefore')}</Text>
        <Text style={styles.body}>{before}</Text>
        <Text style={styles.label}>{t('changeAfter')}</Text>
        <Text style={styles.body}>{after}</Text>
        <Text style={styles.secondary}>{source}</Text>
      </View>
      {onOpenSource && (
        <ActionButton
          secondary
          testID={`record-history-entry-${entry.id}-${fieldId}-source`}
          label={t('openSuggestionFor', { field, time })}
          onPress={onOpenSource}
        />
      )}
    </View>
  );
};
