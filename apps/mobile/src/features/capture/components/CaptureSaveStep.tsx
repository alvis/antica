import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeStatus } from '../../../i18n/messages';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureSaveStepProps = {
  files: LocalMedia[];
  fileErrors: Record<string, string>;
  busy: boolean;
  onSave: () => void;
};

export const CaptureSaveStep: FC<CaptureSaveStepProps> = ({
  files,
  fileErrors,
  busy,
  onSave,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{t('save')}</Text>
      {files.map((file) => (
        <Text
          key={file.id}
          style={file.state === 'failed' ? styles.error : styles.secondary}>
          {fileErrors[file.id]
            ? t('fileStatusWithError', {
                name: file.name,
                status: localizeStatus(file.state, t),
                error: fileErrors[file.id],
              })
            : t('fileStatus', {
                name: file.name,
                status: localizeStatus(file.state, t),
              })}
        </Text>
      ))}
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
