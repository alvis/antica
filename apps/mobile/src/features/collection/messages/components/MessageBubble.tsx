import { StyleSheet, Text, View } from 'react-native';

import { AssistantSeal, theme } from '@antica/ui';

import { splitDiscussContext } from '../discuss-context';

import type { FC } from 'react';

/** properties for one of the collector's messages */
export type MessageBubbleProps = {
  messageId: string;
  /** translated name of the author */
  authorLabel: string;
  body: string;
};

const layout = StyleSheet.create({
  column: {
    alignSelf: 'flex-end',
    maxWidth: '86%',
    alignItems: 'flex-end',
    gap: theme.space[6],
  },
  attached: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[6],
    paddingVertical: theme.space[10],
    paddingHorizontal: 14,
    borderRadius: theme.radius.card,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    backgroundColor: theme.color.bg.surface,
  },
  attachedText: {
    flex: 1,
    ...theme.font.face('sans', '700'),
    fontSize: 12,
    lineHeight: 16.8,
    color: theme.color.assistant.onSoft,
  },
  bubble: {
    paddingVertical: theme.space[10],
    paddingHorizontal: 14,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 4,
    backgroundColor: theme.color.chat.bubble,
  },
  body: {
    ...theme.type.body,
    color: theme.color.chat.onBubble,
  },
});

/**
 * the collector's message (v5 `.me`): a green bubble on the right; a message sent while discussing
 * a suggestion carries that suggestion above it
 * @param props message properties
 * @param props.messageId message identifier used for its automation identifier
 * @param props.authorLabel translated name of the author
 * @param props.body message text
 * @returns the message
 */
export const MessageBubble: FC<MessageBubbleProps> = ({
  messageId,
  authorLabel,
  body,
}) => {
  const { context, text } = splitDiscussContext(body);

  return (
    <View
      testID={`record-message-bubble-${messageId}`}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${authorLabel}: ${[context, text].filter(Boolean).join('\n')}`}
      style={layout.column}>
      {context && (
        <View style={layout.attached}>
          <AssistantSeal size="mini" />
          <Text style={layout.attachedText}>{context}</Text>
        </View>
      )}
      {Boolean(text) && (
        <View style={layout.bubble}>
          <Text style={layout.body}>{text}</Text>
        </View>
      )}
    </View>
  );
};
