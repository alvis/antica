import { ActivityIndicator, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { useLocale } from '../../../../i18n/LocaleProvider';

import { MessageButton } from './MessageButton';

import type { FC } from 'react';

/** properties for the state of a reply that has not arrived */
export type ReplyStatusProps = {
  messageId: string;
  status: 'pending' | 'failed';
  /** whether the reply has been pending long enough to reassure the collector */
  stillWorking: boolean;
  /** failure of the last attempt to send the message again */
  error: string;
  /** posts the message again; absent while sending is unavailable */
  onSendAgain?: () => void;
};

/**
 * renders the thinking, still-working, or failed state of an awaited reply
 * @param props reply state properties
 * @param props.messageId collector message awaiting its reply
 * @param props.status whether the reply is pending or failed
 * @param props.stillWorking whether the pending reply is taking long
 * @param props.error failure of the last resend
 * @param props.onSendAgain posts the message again, absent while unavailable
 * @returns a progress line while pending, or a failure alert with the send-again action
 */
export const ReplyStatus: FC<ReplyStatusProps> = ({
  messageId,
  status,
  stillWorking,
  error,
  onSendAgain,
}) => {
  const { t } = useLocale();

  return status === 'pending' ? (
    <View
      testID={`record-message-thinking-${messageId}`}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t(
        stillWorking ? 'assistantStillWorking' : 'assistantThinking',
      )}
      style={[styles.row, { alignSelf: 'flex-start' }]}>
      <ActivityIndicator color={colors.jade} />
      <Text style={styles.secondary}>
        {t(stillWorking ? 'assistantStillWorking' : 'assistantThinking')}
      </Text>
    </View>
  ) : (
    <View testID={`record-message-failed-${messageId}`} style={{ gap: 8 }}>
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.error}>
        {t('assistantFailed')}
      </Text>
      {Boolean(error) && (
        <Text
          testID={`record-message-send-again-error-${messageId}`}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.error}>
          {error}
        </Text>
      )}
      <MessageButton
        label={t('sendAgain')}
        testID={`record-message-send-again-${messageId}`}
        onPress={onSendAgain}
        secondary
      />
    </View>
  );
};
