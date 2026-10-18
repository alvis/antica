import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { localizeStatus } from '../../../i18n/messages';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';
import type { Translate } from '../../../i18n/messages';

export type CaptureFileStateProps = {
  /** position in the list or grid, counted from 1 */
  index: number;
  file: LocalMedia;
  /** spoken and shown name of the file */
  name: string;
  /** shows the file's name before its state, as the save step lists files */
  named?: boolean;
  /** why the last upload failed, when known; the grid only speaks it */
  error?: string;
  /** another upload or save is running, so retrying waits */
  busy: boolean;
  onRetry: () => void;
};

const layout = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  state: { flex: 1 },
  retry: {
    minWidth: 48,
    minHeight: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { color: colors.jade, fontSize: 16, fontWeight: '600' },
});

/**
 * names a file's upload state; a file that has not finished is never called saved
 * @param file draft file
 * @param t translation function for message keys
 * @returns waiting, uploading with its parts when it has several, uploaded, or not uploaded
 */
export function describeFileState(file: LocalMedia, t: Translate): string {
  // a single-request upload has no parts worth counting
  if (file.state === 'uploading' && file.progress && file.progress.total > 1) {
    return t('uploadProgress', file.progress);
  }

  return file.state === 'failed'
    ? t('uploadNotUploaded')
    : localizeStatus(file.state, t);
}

/**
 * renders one file's upload state, announced as it changes, with a retry for a failed file
 * @param props file, its position and the retry handler
 * @param props.index position from 1, used in test IDs
 * @param props.file draft file
 * @param props.name file name to show and speak
 * @param props.named shows the name before the state
 * @param props.error reason the last upload failed
 * @param props.busy disables retrying while another upload runs
 * @param props.onRetry uploads the file again
 * @returns the state line
 */
export const CaptureFileState: FC<CaptureFileStateProps> = ({
  index,
  file,
  name,
  named = false,
  error,
  busy,
  onRetry,
}) => {
  const { t } = useLocale();
  const status = describeFileState(file, t);
  const uploading = file.state === 'uploading';
  const failed = file.state === 'failed';
  const progress = uploading ? file.progress : undefined;
  const described = error
    ? t('fileStatusWithError', { name, status, error })
    : t('fileStatus', { name, status });

  return (
    <View style={layout.row}>
      <Text
        testID={`capture-file-state-${index}`}
        accessibilityRole={uploading ? 'progressbar' : 'text'}
        accessibilityLabel={described}
        accessibilityLiveRegion="polite"
        // aria props reach both the native accessibility tree and the web build
        aria-busy={uploading}
        aria-valuemin={progress ? 0 : undefined}
        aria-valuemax={progress?.total}
        aria-valuenow={progress?.uploaded}
        style={[layout.state, failed ? styles.error : styles.secondary]}>
        {named ? described : status}
      </Text>
      {failed && (
        <Pressable
          testID={`capture-file-retry-${index}`}
          accessibilityRole="button"
          accessibilityLabel={t('retryFile', { name })}
          accessibilityState={{ disabled: busy }}
          disabled={busy}
          onPress={onRetry}
          style={[layout.retry, busy && { opacity: 0.5 }]}>
          <Text style={layout.retryText}>{t('retry')}</Text>
        </Pressable>
      )}
    </View>
  );
};
