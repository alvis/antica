import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import {
  recordEditNoticeQuery,
  setRecordEditNotice,
} from '../api/record-edit-notice';

import type { FC } from 'react';

/** properties for the notice the editor leaves on the record screen */
export type RecordEditNoticeProps = { recordId: string };

/**
 * tells the collector, once, that their edit was saved on a record the
 * background had meanwhile updated
 * @param props notice properties
 * @param props.recordId record the notice is about
 * @returns the dismissible notice, or nothing without one
 */
export const RecordEditNotice: FC<RecordEditNoticeProps> = ({ recordId }) => {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const notice = useQuery(recordEditNoticeQuery(recordId));
  if (notice.data !== 'refreshed') {
    return null;
  }

  return (
    <View style={{ gap: 8 }}>
      <Text
        testID="record-edit-refreshed"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.body}>
        {t('recordRefreshed')}
      </Text>
      <ActionButton
        secondary
        testID="record-edit-refreshed-dismiss"
        label={t('dismissNotice')}
        onPress={() => setRecordEditNotice(queryClient, recordId, null)}
      />
    </View>
  );
};
