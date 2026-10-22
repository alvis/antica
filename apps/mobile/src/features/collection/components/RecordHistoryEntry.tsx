import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { useKnowledgeTitles } from '../../../hooks/useKnowledgeTitles';
import { localizeProposalField, localizeStatus } from '../../../i18n/messages';
import { formatDateTime } from '../../../utils/calendar';
import { proposalValueText } from '../../../utils/proposal-value';

import { proposalFieldTestId } from '../proposal-field-test-id';

import type { FC, PropsWithChildren } from 'react';

import type { RecordHistoryEntry as HistoryEntry } from '@antica/contracts';

import type { Locale, Translate } from '../../../i18n/messages';

/** properties for one adopted or skipped suggestion in a record's history */
export type RecordHistoryEntryProps = {
  entry: HistoryEntry;
  locale: Locale;
  t: Translate;
  /** opens the analysis or conversation behind the change; absent when it cannot be opened */
  onOpenSource?: () => void;
  /** whether the entry opens or closes the timeline */
  edge?: { first: boolean; last: boolean };
};

const layout = StyleSheet.create({
  item: { position: 'relative', paddingBottom: 18 },
  rule: {
    position: 'absolute',
    left: -17,
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: theme.color.border.strong,
  },
  ruleFirst: { top: 8 },
  // v5's line runs on past the last dot, stopping 8 px above the event's end
  ruleLast: { bottom: 8 },
  dot: {
    position: 'absolute',
    // v5's 14 px ring with a 5 px radius; React Native counts the border inside the size
    left: -23,
    top: 4,
    width: 14,
    height: 14,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: theme.color.accent.default,
    backgroundColor: theme.color.bg.page,
  },
  time: { ...theme.type.small, color: theme.color.text.tertiary },
  title: {
    ...theme.font.face('sans', '700'),
    fontSize: 15,
    lineHeight: 24,
    color: theme.color.text.primary,
  },
  body: { ...theme.type.body2, color: theme.color.text.secondary },
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
});

/** properties for one event on the 紀錄 timeline */
export type HistoryEventProps = PropsWithChildren<{
  /** when it happened, as text */
  time: string;
  title: string;
  /** what changed, such as 口徑約 21.5 公分 → 口徑 21.8 公分 */
  body?: string;
  /** the way back to its source */
  link?: {
    label: string;
    onPress: () => void;
    testID?: string;
    /** what the link opens when several events share its text */
    accessibilityLabel?: string;
  };
  testID?: string;
  /** one spoken summary of the event, when it differs from its text */
  accessibilityLabel?: string;
  /** whether the event opens or closes the timeline, where its rule stops */
  edge?: { first: boolean; last: boolean };
}>;

/**
 * one event on the 紀錄 timeline (v5 `.tl li`): a dot on the rule, when, what happened, what
 * changed, and the way back to its source
 * @param props event properties
 * @param props.time when it happened
 * @param props.title what happened
 * @param props.body what changed
 * @param props.link the way back to its source
 * @param props.testID stable automation identifier
 * @param props.accessibilityLabel spoken summary of the event
 * @param props.edge whether it opens or closes the timeline
 * @returns the event
 */
export const HistoryEvent: FC<HistoryEventProps> = ({
  time,
  title,
  body,
  link,
  testID,
  accessibilityLabel,
  edge = { first: false, last: false },
}) => (
  <View testID={testID} style={layout.item}>
    {!(edge.first && edge.last) && (
      <View
        style={[
          layout.rule,
          edge.first && layout.ruleFirst,
          edge.last && layout.ruleLast,
        ]}
      />
    )}
    <View style={layout.dot} />
    {/* one screen-reader stop for the change; the source link stays separate */}
    <View accessible accessibilityLabel={accessibilityLabel}>
      <Text style={layout.time}>{time}</Text>
      <Text style={layout.title}>{title}</Text>
      {body ? <Text style={layout.body}>{body}</Text> : null}
    </View>
    {link && (
      <Pressable
        testID={link.testID}
        accessibilityRole="link"
        accessibilityLabel={link.accessibilityLabel}
        onPress={link.onPress}
        style={layout.link}>
        <Text style={layout.linkText}>{link.label}</Text>
        <Icon name="chevron" size={18} color={theme.color.accent.default} />
      </Pressable>
    )}
  </View>
);

/** what an adoption event says, by where the change came from and how it was decided */
const titleKeys = {
  analysis: {
    accepted: 'historyAnalysisAccepted',
    skipped: 'historyAnalysisSkipped',
  },
  message: {
    accepted: 'historyMessageAccepted',
    skipped: 'historyMessageSkipped',
  },
} as const;

/**
 * an adopted or skipped suggestion on the timeline: the field, its values before and after, and
 * the analysis or conversation it came from
 * @param props entry properties
 * @param props.entry adopted or skipped suggestion
 * @param props.locale active interface locale
 * @param props.t translation function for message keys
 * @param props.onOpenSource opens the analysis or conversation behind it
 * @param props.edge whether it opens or closes the timeline
 * @returns the timeline event
 */
export const RecordHistoryEntry: FC<RecordHistoryEntryProps> = ({
  entry,
  locale,
  t,
  onOpenSource,
  edge,
}) => {
  const field = localizeProposalField(entry.field, t);
  const fieldId = proposalFieldTestId(entry.field);
  const time = formatDateTime(entry.occurredAt, locale);
  const title = useKnowledgeTitles(
    entry.field === 'materialIds' || entry.field === 'categoryIds'
      ? [...entry.before, ...entry.after]
      : [],
  );
  const before = proposalValueText(entry, entry.before, locale, t, title);
  const after = proposalValueText(entry, entry.after, locale, t, title);
  const kind = entry.source.kind === 'analysis' ? 'analysis' : 'message';
  const heading = t(titleKeys[kind][entry.status], { field });

  return (
    <View testID={`record-history-entry-${entry.id}`}>
      <HistoryEvent
        testID={`record-history-entry-${entry.id}-${fieldId}-${entry.status}`}
        edge={edge}
        time={time}
        title={heading}
        body={
          entry.status === 'accepted'
            ? t('historyChange', { before, after })
            : t('historyNotWritten', { value: after })
        }
        accessibilityLabel={t('historyEntrySummary', {
          heading: t('historyHeading', {
            field,
            status: localizeStatus(entry.status, t),
          }),
          time,
          before,
          after,
          source: t(
            kind === 'analysis' ? 'fromAnalysis' : 'editedByVoiceOrMessage',
          ),
        })}
        link={
          onOpenSource
            ? {
                label: t(
                  kind === 'analysis'
                    ? 'historyOpenAnalysis'
                    : 'historyOpenConversation',
                ),
                onPress: onOpenSource,
                testID: `record-history-entry-${entry.id}-${fieldId}-source`,
                accessibilityLabel: t('openSuggestionFor', { field, time }),
              }
            : undefined
        }
      />
    </View>
  );
};

/**
 * formats when a change was decided in the collector's language
 * @param occurredAt ISO instant of the decision
 * @param locale active interface locale
 * @returns localized date and time
 */
export function formatHistoryTime(occurredAt: string, locale: Locale): string {
  return formatDateTime(occurredAt, locale);
}
