import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { recordMessageBodyMaxLength } from '@antica/contracts';
import { AssistantSeal, Icon, theme } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { KnowledgeAttachment } from '@antica/contracts';
import type { IconName } from '@antica/ui';

import type { ComposerKnowledgeAttachment } from '../hooks/useMessageComposer';

import type { VoiceMessagePhase } from '../hooks/useVoiceMessage';

/** properties for the message composer */
export type MessageComposerProps = {
  hint?: string;
  /** the input's placeholder, which says what the segment expects */
  placeholder: string;
  attachments: ComposerKnowledgeAttachment[];
  onRemoveAttachment: (reference: KnowledgeAttachment) => void;
  /** the suggestion under discussion, shown as a chip above the input */
  discussing?: { label: string; onRemove: () => void };
  busy?: boolean;
  text: string;
  onChangeText: (text: string) => void;
  /** posts the text; absent while it cannot be sent */
  onSend?: () => void;
  voicePhase: VoiceMessagePhase;
  /** starts or stops recording; absent while voice is unavailable */
  onVoice?: () => void;
  /** opens the camera for this record */
  onCapture: () => void;
  /** whether the 相關知識 tray is open */
  relatedOpen: boolean;
  onToggleRelated: () => void;
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

const layout = StyleSheet.create({
  frame: {
    backgroundColor: theme.color.bg.dock,
    borderTopWidth: theme.border.hairline.width,
    borderTopColor: theme.border.hairline.color,
  },
  status: {
    paddingTop: theme.space[8],
    paddingHorizontal: theme.space[16],
    gap: theme.space[4],
  },
  statusText: { ...theme.type.small, color: theme.color.text.secondary },
  error: { ...theme.type.small, color: theme.color.status.danger },
  chips: {
    paddingTop: theme.space[8],
    paddingHorizontal: theme.space[12],
    gap: theme.space[8],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    paddingVertical: theme.space[2],
    paddingLeft: theme.space[8],
    paddingRight: theme.space[2],
    borderRadius: theme.radius.field,
  },
  discussChip: { backgroundColor: theme.color.assistant.soft },
  knowledgeChip: { backgroundColor: theme.color.accent.soft },
  chipText: { flex: 1, minWidth: 0, ...theme.type.small },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
    paddingTop: theme.space[6],
    paddingHorizontal: theme.space[8],
    paddingBottom: theme.space[8],
  },
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.size.hitMin,
    maxHeight: 132,
    borderRadius: 24,
    paddingHorizontal: theme.space[16],
    paddingVertical: theme.space[6],
    backgroundColor: theme.color.bg.sunken,
    color: theme.color.text.primary,
    ...theme.font.face('sans', '400'),
    fontSize: 15,
    lineHeight: 22,
    // a single line sits at the pill's 48 dp; Android's font padding would add about 14 dp
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  icon: {
    width: theme.size.iconButton,
    height: theme.size.iconButton,
    borderRadius: theme.size.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOn: { backgroundColor: theme.color.accent.soft },
  send: { backgroundColor: theme.color.action.primary },
  pressed: { opacity: 0.7 },
  remove: {
    width: theme.size.hitMin,
    height: theme.size.hitMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/** properties for one round icon control in the composer row */
type ComposerIconProps = {
  icon: IconName;
  label: string;
  onPress?: () => void;
  testID: string;
  tint?: string;
  style?: object;
  selected?: boolean;
};

/**
 * a 48 dp round icon control of the composer row
 * @param props control properties
 * @param props.icon which icon
 * @param props.label spoken name
 * @param props.onPress action; the control is disabled without one
 * @param props.testID stable automation identifier
 * @param props.tint icon colour
 * @param props.style extra frame style
 * @param props.selected whether the control is toggled on
 * @returns the control
 */
const ComposerIcon: FC<ComposerIconProps> = ({
  icon,
  label,
  onPress,
  testID,
  tint = theme.color.text.primary,
  style,
  selected,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !onPress, expanded: selected }}
    disabled={!onPress}
    onPress={onPress}
    style={({ pressed }) => [layout.icon, style, pressed && layout.pressed]}>
    <Icon name={icon} color={onPress ? tint : theme.color.text.tertiary} />
  </Pressable>
);

/**
 * the composer (v5 `.composer`): camera, 相關知識, the message pill and voice, which turns into
 * send once there is something to send; chips above it show the suggestion under discussion and
 * the sources picked to send with the message
 * @param props composer properties
 * @param props.hint explains required source reselection after restoring text
 * @param props.placeholder the input's placeholder
 * @param props.attachments visible collector-selected claims
 * @param props.onRemoveAttachment removes a selected reference
 * @param props.discussing the suggestion under discussion
 * @param props.busy locks selection during sending
 * @param props.text current message text
 * @param props.onChangeText receives edited text
 * @param props.onSend posts the text, absent while unavailable
 * @param props.voicePhase where the spoken message stands
 * @param props.onVoice starts or stops recording, absent while unavailable
 * @param props.onCapture opens the camera
 * @param props.relatedOpen whether the 相關知識 tray is open
 * @param props.onToggleRelated opens or closes the tray
 * @param props.error failure of the last send or recording
 * @returns the composer
 */
export const MessageComposer: FC<MessageComposerProps> = ({
  hint,
  placeholder,
  attachments,
  onRemoveAttachment,
  discussing,
  busy,
  text,
  onChangeText,
  onSend,
  voicePhase,
  onVoice,
  onCapture,
  relatedOpen,
  onToggleRelated,
  error,
}) => {
  const { t } = useLocale();
  const voiceHint = voiceHints[voicePhase];
  const sendable =
    text.trim() !== '' && !['recording', 'transcribing'].includes(voicePhase);

  return (
    <View style={layout.frame}>
      {[voiceHint, error, hint].some(Boolean) && (
        <View style={layout.status}>
          {voiceHint && (
            <Text
              testID="record-message-voice-status"
              accessibilityLiveRegion="polite"
              style={
                voicePhase === 'failed' ? layout.error : layout.statusText
              }>
              {t(voiceHint)}
            </Text>
          )}
          {Boolean(error) && (
            <Text
              testID="record-message-error"
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              style={layout.error}>
              {error}
            </Text>
          )}
          {Boolean(hint) && (
            <Text
              testID="record-message-reattach-hint"
              accessibilityLiveRegion="polite"
              style={layout.statusText}>
              {hint}
            </Text>
          )}
        </View>
      )}
      {(discussing || attachments.length > 0) && (
        <View style={layout.chips}>
          {discussing && (
            <View
              testID="record-message-discussing"
              style={[layout.chip, layout.discussChip]}>
              <AssistantSeal size="mini" />
              <Text
                numberOfLines={1}
                style={[
                  layout.chipText,
                  { color: theme.color.assistant.onSoft },
                ]}>
                {discussing.label}
              </Text>
              <Pressable
                testID="record-message-discussing-remove"
                accessibilityRole="button"
                accessibilityLabel={t('discussRemove')}
                onPress={discussing.onRemove}
                style={layout.remove}>
                <Icon
                  name="close"
                  size={18}
                  color={theme.color.assistant.onSoft}
                />
              </Pressable>
            </View>
          )}
          {attachments.map(({ reference, title }) => (
            <View
              key={`${reference.entryId}-${reference.revision}-${reference.claimKey}`}
              testID={`record-message-evidence-attachment-${reference.claimKey}`}
              style={[layout.chip, layout.knowledgeChip]}>
              <Icon name="book" size={16} color={theme.color.accent.onSoft} />
              <Text
                numberOfLines={1}
                style={[layout.chipText, { color: theme.color.accent.onSoft }]}>
                {title}
              </Text>
              <Pressable
                testID={`record-message-evidence-remove-${reference.claimKey}`}
                accessibilityRole="button"
                accessibilityLabel={t('knowledgeRemoveNamedAttachment', {
                  title,
                  claim: reference.claimKey,
                })}
                disabled={busy}
                onPress={() => onRemoveAttachment(reference)}
                style={layout.remove}>
                <Icon
                  name="close"
                  size={18}
                  color={theme.color.accent.onSoft}
                />
              </Pressable>
            </View>
          ))}
          {attachments.length > 0 && (
            <Text accessibilityLiveRegion="polite" style={layout.statusText}>
              {t('knowledgeAttachmentCount', { count: attachments.length })}
            </Text>
          )}
        </View>
      )}
      <View style={layout.row}>
        <ComposerIcon
          testID="record-message-capture"
          icon="camera"
          label={t('messageCapture')}
          onPress={onCapture}
        />
        <ComposerIcon
          testID="record-messages-related-toggle"
          icon="book"
          label={t('knowledgeRelated')}
          onPress={onToggleRelated}
          selected={relatedOpen}
          style={relatedOpen ? layout.iconOn : undefined}
        />
        <TextInput
          testID="record-message-input"
          accessibilityLabel={t('messageInput')}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.tertiary}
          multiline
          maxLength={recordMessageBodyMaxLength}
          editable={voicePhase !== 'recording' && voicePhase !== 'transcribing'}
          value={text}
          onChangeText={onChangeText}
          style={layout.input}
        />
        {sendable ? (
          <ComposerIcon
            testID="record-message-send"
            icon="arrow"
            label={t('sendMessage')}
            onPress={onSend}
            tint={theme.color.action.onPrimary}
            style={onSend ? layout.send : undefined}
          />
        ) : (
          <ComposerIcon
            testID="record-message-voice"
            icon="mic"
            label={t(
              voicePhase === 'recording'
                ? 'stopVoiceMessage'
                : 'recordVoiceMessage',
            )}
            onPress={onVoice}
            selected={voicePhase === 'recording'}
            style={voicePhase === 'recording' ? layout.iconOn : undefined}
          />
        )}
      </View>
    </View>
  );
};
