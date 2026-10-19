import { Text, View } from 'react-native';

import { styles } from '@antica/ui';

import { BusyButton } from '../../../components/BusyButton';
import { useLocale } from '../../../providers/LocaleProvider';
import { shortId } from '../../../utils/short-id';

import type { FC } from 'react';

import type { NextAction } from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';

/** properties for the banner of a capture opened from an analysis action */
export type CaptureActionLinkProps = {
  /** the action being answered, once its run has loaded */
  action: NextAction | undefined;
  /** check the new evidence is linked to, when the action names one */
  checkId: string | undefined;
  /** why the action cannot receive this capture's evidence, when it cannot */
  problem: Extract<MessageKey, 'actionRecordMismatch' | 'actionMissing'> | null;
  busy: boolean;
  /** marks the action supplied with the confirmed words and returns to the run; absent until words are confirmed */
  onFinish?: () => void;
};

/**
 * names the action and check a capture answers, and finishes a spoken or typed answer (C04)
 * @param props banner properties
 * @param props.action action being answered
 * @param props.checkId linked check, when any
 * @param props.problem reason the action cannot be answered, when any
 * @param props.busy whether another capture action is running
 * @param props.onFinish finishes a description answer, when one is ready
 * @returns the link banner
 */
export const CaptureActionLink: FC<CaptureActionLinkProps> = ({
  action,
  checkId,
  problem,
  busy,
  onFinish,
}) => {
  const { t } = useLocale();

  return (
    <View testID="capture-action-link" style={styles.card}>
      {action && (
        <Text style={styles.heading}>
          {t('captureForAction', { instruction: action.instruction })}
        </Text>
      )}
      {problem ? (
        <Text
          testID="capture-action-problem"
          accessibilityRole="alert"
          style={styles.error}>
          {t(problem)}
        </Text>
      ) : (
        <Text
          testID={checkId ? 'capture-action-check' : 'capture-action-unlinked'}
          style={styles.secondary}>
          {checkId
            ? t('captureLinkedCheck', { id: shortId(checkId) })
            : t('captureUnlinked')}
        </Text>
      )}
      {onFinish && (
        <BusyButton
          testID="capture-action-finish"
          label={t('supplied')}
          onPress={onFinish}
          busy={busy}
        />
      )}
    </View>
  );
};
