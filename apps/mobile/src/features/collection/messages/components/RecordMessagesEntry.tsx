import { Pressable, Text } from 'react-native';

import { styles } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';

import type { FC } from 'react';

/** properties for the record screen's way into the message area */
export type RecordMessagesEntryProps = {
  /** newest message, or null when the conversation has not started */
  preview: string | null;
  onOpen: () => void;
};

/**
 * renders the labelled entry to a record's messages with the newest message as a preview
 * @param props entry properties
 * @param props.preview newest message text, or null before the first message
 * @param props.onOpen opens the message area
 * @returns the pressable entry card
 */
export const RecordMessagesEntry: FC<RecordMessagesEntryProps> = ({
  preview,
  onOpen,
}) => {
  const { t } = useLocale();
  const summary = preview ?? t('noMessages');

  return (
    <Pressable
      testID="record-messages-entry"
      accessibilityRole="button"
      accessibilityLabel={t('openMessagesSummary', { summary })}
      onPress={onOpen}
      style={[styles.card, { minHeight: 48 }]}>
      <Text style={styles.heading}>{t('messages')}</Text>
      <Text numberOfLines={2} style={styles.secondary}>
        {summary}
      </Text>
    </Pressable>
  );
};
