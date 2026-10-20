import { Text, TextInput, View } from 'react-native';

import { recordMessageBodyMaxLength } from '@antica/contracts';
import { ActionButton, colors, styles } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';

import { MessageButton } from './MessageButton';

import type { FC } from 'react';

import type { KnowledgeAttachment } from '@antica/contracts';

import type { ComposerKnowledgeAttachment } from '../hooks/useMessageComposer';

import type { VoiceMessagePhase } from '../hooks/useVoiceMessage';

/** properties for the message composer */
export type MessageComposerProps = {
  hint?: string;
  attachments: ComposerKnowledgeAttachment[];
  onRemoveAttachment: (reference: KnowledgeAttachment) => void;
  busy?: boolean;
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
 * @param props.hint explains required source reselection after restoring text
 * @param props.attachments visible collector-selected claims
 * @param props.onRemoveAttachment removes a selected reference
 * @param props.busy locks selection during sending
 * @param props.text current message text
 * @param props.onChangeText receives edited text
 * @param props.onSend posts the text, absent while unavailable
 * @param props.voicePhase where the spoken message stands
 * @param props.onVoice starts or stops recording, absent while unavailable
 * @param props.error failure of the last send or recording
 * @returns a status line, the text input, and the voice and send buttons
 */
export const MessageComposer: FC<MessageComposerProps> = ({
  hint,
  attachments,
  onRemoveAttachment,
  busy,
  text,
  onChangeText,
  onSend,
  voicePhase,
  onVoice,
  error,
}) => {
  const { t } = useLocale();

  return (
    <View
      style={{
        gap: 8,
        padding: 16,
        borderTopWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.canvas,
      }}>
      <ComposerStatus voicePhase={voicePhase} error={error} />
      {Boolean(hint) && (
        <Text
          testID="record-message-reattach-hint"
          accessibilityLiveRegion="polite"
          style={styles.secondary}>
          {hint}
        </Text>
      )}
      <KnowledgeAttachmentChips
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        busy={busy}
      />
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
      <ComposerActions
        voicePhase={voicePhase}
        onVoice={onVoice}
        onSend={onSend}
      />
    </View>
  );
};

/**
 * Shows removable references before the collector sends the message.
 * @param props selected sources and removal action
 * @param props.attachments exact revisions and claims to send
 * @param props.onRemoveAttachment explicit remove action
 * @param props.busy locks removal while posting
 * @returns visible attachment chips and count
 */
const KnowledgeAttachmentChips: FC<
  Pick<MessageComposerProps, 'attachments' | 'onRemoveAttachment' | 'busy'>
> = ({ attachments, onRemoveAttachment, busy }) => {
  const { t } = useLocale();

  return (
    <>
      {attachments.map(({ reference, title }) => (
        <View
          key={`${reference.entryId}-${reference.revision}-${reference.claimKey}`}
          testID={`record-message-evidence-attachment-${reference.claimKey}`}>
          <Text style={styles.body}>
            {title} ·{' '}
            {t('knowledgePinnedRevision', { revision: reference.revision })} ·{' '}
            {reference.claimKey}
          </Text>
          <ActionButton
            testID={`record-message-evidence-remove-${reference.claimKey}`}
            label={t('knowledgeRemoveNamedAttachment', {
              title,
              claim: reference.claimKey,
            })}
            disabled={busy}
            onPress={() => onRemoveAttachment(reference)}
            secondary
          />
        </View>
      ))}
      {attachments.length > 0 && (
        <Text accessibilityLiveRegion="polite" style={styles.secondary}>
          {t('knowledgeAttachmentCount', { count: attachments.length })}
        </Text>
      )}
    </>
  );
};

/**
 * Offers explicit voice and send actions beside the draft.
 * @param props available recording and posting actions
 * @param props.voicePhase current voice state
 * @param props.onVoice optional recording action
 * @param props.onSend optional explicit send
 * @returns accessible action row
 */
const ComposerActions: FC<
  Pick<MessageComposerProps, 'voicePhase' | 'onVoice' | 'onSend'>
> = ({ voicePhase, onVoice, onSend }) => {
  const { t } = useLocale();

  return (
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
  );
};

/**
 * Announces voice progress and recoverable failures beside the draft.
 * @param props voice and error state
 * @param props.voicePhase recording or transcription progress
 * @param props.error failure text, empty when ready
 * @returns live status messages
 */
const ComposerStatus: FC<
  Pick<MessageComposerProps, 'voicePhase' | 'error'>
> = ({ voicePhase, error }) => {
  const { t } = useLocale();
  const hint = voiceHints[voicePhase];

  return (
    <>
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
    </>
  );
};
