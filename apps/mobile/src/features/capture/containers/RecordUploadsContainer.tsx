import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { useUnfinishedUploads } from '../hooks/useUnfinishedUploads';

import type { FC } from 'react';

export type RecordUploadsContainerProps = { recordId: string };

/**
 * tells the record's detail how many of its files have not uploaded, never counting them as
 * saved, with a retry that opens their upload
 * @param props the record shown
 * @param props.recordId record whose unfinished files are counted
 * @returns the notice, or nothing when every file uploaded
 */
export const RecordUploadsContainer: FC<RecordUploadsContainerProps> = ({
  recordId,
}) => {
  const router = useRouter();
  const { t } = useLocale();
  const unfinished = useUnfinishedUploads().find(
    (group) => group.recordId === recordId,
  );

  if (!unfinished) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text
        testID="record-files-not-uploaded"
        accessibilityRole="alert"
        style={styles.error}>
        {t('filesNotUploaded', { count: unfinished.count })}
      </Text>
      <ActionButton
        testID="record-files-retry"
        label={t('retryUpload')}
        onPress={() => router.push(`/capture?recordId=${recordId}&resume=1`)}
      />
    </View>
  );
};
