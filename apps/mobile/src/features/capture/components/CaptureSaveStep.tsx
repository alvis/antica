import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { CaptureFileState } from './CaptureFileState';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureSaveStepProps = {
  files: LocalMedia[];
  fileErrors: Record<string, string>;
  busy: boolean;
  onSave: () => void;
  /** uploads one failed file again */
  onRetry: (fileId: string) => void;
  /** uploads every failed file again */
  onRetryAll: () => void;
};

/**
 * renders the save step: every file with its upload state and retry, a retry for all failed
 * files once two or more failed, and the save action
 * @param props files, their errors and the save and retry handlers
 * @param props.files files that will be saved
 * @param props.fileErrors reasons the last attempt failed, by file
 * @param props.busy whether a save or retry is running
 * @param props.onSave saves the record and uploads its files
 * @param props.onRetry uploads one failed file again
 * @param props.onRetryAll uploads every failed file again
 * @returns the save card
 */
export const CaptureSaveStep: FC<CaptureSaveStepProps> = ({
  files,
  fileErrors,
  busy,
  onSave,
  onRetry,
  onRetryAll,
}) => {
  const { t } = useLocale();
  const failedCount = files.filter((file) => file.state === 'failed').length;

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('save')}</Text>
      {files.map((file, index) => (
        <CaptureFileState
          key={file.id}
          index={index + 1}
          file={file}
          name={file.name}
          named
          error={fileErrors[file.id]}
          busy={busy}
          onRetry={() => onRetry(file.id)}
        />
      ))}
      {failedCount >= 2 && (
        <ActionButton
          testID="capture-retry-all"
          label={t('retryAllFailed', { count: failedCount })}
          onPress={onRetryAll}
          disabled={busy}
          secondary
        />
      )}
      <ActionButton
        testID="capture-save"
        label={busy ? t('processing') : t('save')}
        onPress={onSave}
        disabled={busy}
      />
      <Text style={styles.secondary}>{t('notAnalyzed')}</Text>
    </View>
  );
};
