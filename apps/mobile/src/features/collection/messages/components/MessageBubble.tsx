import { Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import type { FC } from 'react';

import type { RecordMessageAuthor } from '@antica/contracts';

/** properties for one message of the conversation */
export type MessageBubbleProps = {
  messageId: string;
  author: RecordMessageAuthor;
  /** translated name of the author */
  authorLabel: string;
  body: string;
};

const bubbleStyles = {
  collector: {
    alignSelf: 'flex-end',
    backgroundColor: colors.jade,
    borderColor: colors.jade,
  },
  assistant: {
    alignSelf: 'flex-start',
    backgroundColor: colors.card,
    borderColor: colors.border,
  },
} as const;

/**
 * renders a collector or assistant message, aligned and colored by its author
 * @param props message properties
 * @param props.messageId message identifier used for its automation identifier
 * @param props.author who wrote the message
 * @param props.authorLabel translated name of the author
 * @param props.body message text
 * @returns a speech bubble aligned to its author's side
 */
export const MessageBubble: FC<MessageBubbleProps> = ({
  messageId,
  author,
  authorLabel,
  body,
}) => {
  const textColor = author === 'collector' ? colors.card : colors.text;

  return (
    <View
      testID={`record-message-bubble-${messageId}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${authorLabel}: ${body}`}
      style={[
        {
          maxWidth: '85%',
          borderWidth: 1,
          borderRadius: 12,
          padding: 12,
          gap: 4,
        },
        bubbleStyles[author],
      ]}>
      <Text style={[styles.label, { color: textColor }]}>{authorLabel}</Text>
      <Text style={[styles.body, { color: textColor }]}>{body}</Text>
    </View>
  );
};
