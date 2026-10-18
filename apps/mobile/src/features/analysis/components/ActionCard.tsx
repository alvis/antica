import { Text, View } from 'react-native';

import { ActionButton, TextField, colors, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';
import { shortId } from '../../../utils/short-id';

import type { FC } from 'react';

import type { ActionState, NextAction } from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** properties for one suggested inspection action (C04) */
export type ActionCardProps = {
  action: NextAction;
  /** saved state of the action; pending until the collector resolves it */
  status: ActionState['status'];
  /** reason or on-site note typed for a text resolution */
  note: string;
  onNoteChange: (note: string) => void;
  /** whether another analysis request is running */
  busy: boolean;
  /** whether the record has loaded, which resolutions need for their revision */
  canResolve: boolean;
  /** opens capture pre-linked to this action and its check */
  onCapture: () => void;
  /** opens the spoken or typed observation path pre-linked the same way */
  onDescribe: () => void;
  /** opens the linked check, offered only when the action names one */
  onOpenCheck: () => void;
  /** saves a text resolution; absent while the action has no saved state to revise */
  onResolve?: (status: 'supplied' | 'dismissed') => void;
};

const statusKeys = {
  pending: 'actionNeedsEvidence',
  supplied: 'supplied',
  dismissed: 'dismissed',
} as const satisfies Record<ActionState['status'], MessageKey>;

/** kinds answered with a new image rather than words */
const photoKinds = new Set<NextAction['kind']>([
  'capturePhoto',
  'selectVideoFrame',
]);

/**
 * labels the saved state of an action
 * @param props badge properties
 * @param props.actionId action the state belongs to
 * @param props.status saved action state
 * @returns the state badge
 */
const ActionStatusBadge: FC<{
  actionId: string;
  status: ActionState['status'];
}> = ({ actionId, status }) => {
  const { t } = useLocale();
  const pending = status === 'pending';

  return (
    <Text
      testID={`analysis-action-status-${status}-${actionId}`}
      accessibilityLabel={t(statusKeys[status])}
      style={[
        styles.label,
        {
          borderWidth: 1,
          borderRadius: 16,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderColor: pending ? colors.error : colors.border,
          color: pending ? colors.error : colors.muted,
        },
      ]}>
      {t(statusKeys[status])}
    </Text>
  );
};

/**
 * saves a typed note as supplied evidence or as the reason to dismiss the action
 * @param props resolution properties
 * @param props.note typed reason or on-site note
 * @param props.onNoteChange receives the edited note
 * @param props.disabled whether resolution may not be submitted
 * @param props.onResolve saves the note with the chosen state
 * @returns the note field and its two resolutions
 */
const ActionResolution: FC<
  Pick<ActionCardProps, 'note' | 'onNoteChange'> & {
    disabled: boolean;
    onResolve: (status: 'supplied' | 'dismissed') => void;
  }
> = ({ note, onNoteChange, disabled, onResolve }) => {
  const { t } = useLocale();

  return (
    <>
      <TextField
        label={t('reason')}
        value={note}
        onChangeText={onNoteChange}
        multiline
      />
      <ActionButton
        label={t('supplied')}
        onPress={() => onResolve('supplied')}
        disabled={disabled}
        secondary
      />
      <ActionButton
        label={t('dismiss')}
        onPress={() => onResolve('dismissed')}
        disabled={disabled}
        secondary
      />
    </>
  );
};

/**
 * shows an action with its saved state, its check, and capture, description, and resolution controls
 * @param props card properties
 * @param props.action suggested inspection action
 * @param props.status saved action state
 * @param props.note typed reason or on-site note
 * @param props.onNoteChange receives the edited note
 * @param props.busy whether another analysis request is running
 * @param props.canResolve whether resolution may be submitted
 * @param props.onCapture opens linked capture
 * @param props.onDescribe opens the linked observation path
 * @param props.onOpenCheck opens the linked check
 * @param props.onResolve saves the note as supplied evidence or as the dismissal reason
 * @returns a card with the instruction, its saved state, and its controls
 */
export const ActionCard: FC<ActionCardProps> = ({
  action,
  status,
  note,
  onNoteChange,
  busy,
  canResolve,
  onCapture,
  onDescribe,
  onOpenCheck,
  onResolve,
}) => {
  const { t } = useLocale();
  const photoFirst = photoKinds.has(action.kind);
  const pending = status === 'pending';
  const capture = (
    <ActionButton
      key="capture"
      testID={`analysis-action-capture-${action.id}`}
      label={t('capturePhoto')}
      onPress={onCapture}
      disabled={busy}
      secondary={!photoFirst}
    />
  );
  const describe = (
    <ActionButton
      key="describe"
      testID={`analysis-action-describe-${action.id}`}
      label={t('addDescription')}
      onPress={onDescribe}
      disabled={busy}
      secondary={photoFirst}
    />
  );

  return (
    <View testID={`analysis-action-${action.id}`} style={styles.card}>
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.heading, { flexShrink: 1 }]}>
          {action.instruction}
        </Text>
        <ActionStatusBadge actionId={action.id} status={status} />
      </View>
      <Text style={styles.secondary}>{action.reason}</Text>
      {action.checkId && (
        <ActionButton
          testID={`analysis-action-check-${action.id}`}
          label={t('linkedCheck', { id: shortId(action.checkId) })}
          onPress={onOpenCheck}
          secondary
        />
      )}
      {pending && (
        <>
          {photoFirst ? [capture, describe] : [describe, capture]}
          {onResolve && (
            <ActionResolution
              note={note}
              onNoteChange={onNoteChange}
              disabled={busy || !canResolve}
              onResolve={onResolve}
            />
          )}
        </>
      )}
    </View>
  );
};
