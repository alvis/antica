import { Text, TextInput, View } from 'react-native';

import { recordMessageBodyMaxLength } from '@antica/contracts';
import { colors, styles } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';

import { MessageButton } from './MessageButton';

import type { FC } from 'react';

import type { VoiceMessagePhase } from '../hooks/useVoiceMessage';

/** properties for the message composer */
export type MessageComposerProps = {
  text: string;
  onChangeText: (text: string) => void;
  /** posts the text; absent while it cannot be sent */
  onSend?: () => void;
  voicePhase: VoiceMessagePhase;
  /** starts or stops recording; absent while voice is unavailable */
  onVoice?: () => void;
  /** failure of the last send or recording */
  error: string;
};

const voiceHints = {
  idle: null,
  recording: 'voiceRecording',
  transcribing: 'voiceTranscribing',
  ready: 'voiceReady',
  failed: 'voiceFailed',
} as const;

/**
 * renders the multiline message input with its voice and send actions
 * @param props composer properties
 * @param props.text current message text
 * @param props.onChangeText receives edited text
 * @param props.onSend posts the text, absent while unavailable
 * @param props.voicePhase where the spoken message stands
 * @param props.onVoice starts or stops recording, absent while unavailable
 * @param props.error failure of the last send or recording
 * @returns a status line, the text input, and the voice and send buttons
 */
export const MessageComposer: FC<MessageComposerProps> = ({
  text,
  onChangeText,
  onSend,
  voicePhase,
  onVoice,
  error,
}) => {
  const { t } = useLocale();
  const hint = voiceHints[voicePhase];

  return (
    <View
      style={{
        gap: 8,
        padding: 16,
        borderTopWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.canvas,
      }}>
      {hint && (
        <Text
          testID="record-message-voice-status"
          accessibilityLiveRegion="polite"
          style={voicePhase === 'failed' ? styles.error : styles.secondary}>
          {t(hint)}
        </Text>
      )}
      {Boolean(error) && (
        <Text
          testID="record-message-error"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {error}
        </Text>
      )}
      <TextInput
        testID="record-message-input"
        accessibilityLabel={t('messageInput')}
        placeholder={t('messageInput')}
        placeholderTextColor={colors.muted}
        multiline
        maxLength={recordMessageBodyMaxLength}
        editable={voicePhase !== 'recording' && voicePhase !== 'transcribing'}
        value={text}
        onChangeText={onChangeText}
        style={[styles.field, { maxHeight: 160 }]}
      />
      <View style={styles.row}>
        <View style={{ flexGrow: 1 }}>
          <MessageButton
            label={t(
              voicePhase === 'recording'
                ? 'stopVoiceMessage'
                : 'recordVoiceMessage',
            )}
            testID="record-message-voice"
            onPress={onVoice}
            secondary
          />
        </View>
        <View style={{ flexGrow: 1 }}>
          <MessageButton
            label={t('sendMessage')}
            testID="record-message-send"
            onPress={onSend}
          />
        </View>
      </View>
    </View>
  );
};
