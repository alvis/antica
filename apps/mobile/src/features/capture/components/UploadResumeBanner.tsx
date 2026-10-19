import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export type UploadResumeBannerProps = {
  /** record name, or its code while it has none */
  recordLabel: string;
  /** files of the record that have not finished uploading */
  count: number;
  /** the collector asked to discard, so the banner asks to confirm */
  confirming: boolean;
  onResume: () => void;
  onDiscard: () => void;
  onConfirmDiscard: () => void;
  onKeep: () => void;
};

/**
 * renders the prompt shown after a restart for files that never finished uploading; nothing
 * uploads until the collector resumes, and discarding asks once more before deleting the copies
 * @param props the record, its unfinished count and the handlers
 * @param props.recordLabel record name or code
 * @param props.count files still to upload
 * @param props.confirming shows the discard confirmation instead of the actions
 * @param props.onResume opens the record's upload and continues it
 * @param props.onDiscard asks to confirm discarding
 * @param props.onConfirmDiscard deletes the local copies
 * @param props.onKeep keeps the files and closes the confirmation
 * @returns the non-blocking banner
 */
export const UploadResumeBanner: FC<UploadResumeBannerProps> = ({
  recordLabel,
  count,
  confirming,
  onResume,
  onDiscard,
  onConfirmDiscard,
  onKeep,
}) => {
  const { t } = useLocale();

  return (
    <View
      testID="upload-resume-banner"
      accessibilityLiveRegion="polite"
      style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('uploadResumeTitle', { count, record: recordLabel })}
      </Text>
      {confirming ? (
        <>
          <Text style={styles.body}>
            {t('uploadDiscardConfirm', { count })}
          </Text>
          <ActionButton
            testID="upload-discard-confirm"
            label={t('uploadDiscardYes')}
            onPress={onConfirmDiscard}
          />
          <ActionButton
            testID="upload-discard-keep"
            label={t('uploadDiscardKeep')}
            onPress={onKeep}
            secondary
          />
        </>
      ) : (
        <>
          <Text style={styles.secondary}>{t('uploadResumeNote')}</Text>
          <ActionButton
            testID="upload-resume"
            label={t('uploadResume')}
            onPress={onResume}
          />
          <ActionButton
            testID="upload-discard"
            label={t('uploadDiscard')}
            onPress={onDiscard}
            secondary
          />
        </>
      )}
    </View>
  );
};
