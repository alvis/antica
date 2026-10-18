import { useInfiniteQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { FlatList, Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { useAuth } from '../../../providers/AuthProvider';

import { historySourceRoute, recordHistoryQuery } from '../api/record-history';
import { RecordHistoryEntry } from '../components/RecordHistoryEntry';

import type { FC } from 'react';

import type { MessageKey } from '../../../i18n/messages';

/** properties for a record's change history screen */
export type RecordHistoryContainerProps = { recordId: string };

/**
 * lists the suggestions accepted or skipped for a record, newest first, and opens the suggestion behind each
 * @param props screen properties
 * @param props.recordId record whose history is shown
 * @returns the change history screen
 */
export const RecordHistoryContainer: FC<RecordHistoryContainerProps> = ({
  recordId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { locale, t } = useLocale();
  const history = useInfiniteQuery(recordHistoryQuery(api, recordId));
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen title={t('changeHistory')} scrollable={false}>
      <QueryState
        loading={history.isPending}
        // a failed older page keeps the entries already shown
        error={history.data ? null : history.error}
        retry={() => void history.refetch()}>
        <FlatList
          testID="record-history"
          accessibilityLabel={t('changeHistory')}
          data={entries}
          keyExtractor={(entry) => entry.id}
          contentContainerStyle={styles.content}
          ListHeaderComponent={
            history.isRefetchError ? (
              <RefreshNotice onRetry={() => void history.refetch()} t={t} />
            ) : null
          }
          renderItem={({ item }) => {
            const route = historySourceRoute(recordId, item.source);

            return (
              <RecordHistoryEntry
                entry={item}
                locale={locale}
                t={t}
                onOpenSource={route ? () => router.push(route) : undefined}
              />
            );
          }}
          ListEmptyComponent={
            <Text style={styles.secondary}>{t('changeHistoryEmpty')}</Text>
          }
          ListFooterComponent={
            history.hasNextPage ? (
              <OlderChanges
                loading={history.isFetchingNextPage}
                failed={history.isFetchNextPageError}
                onLoad={() => void history.fetchNextPage()}
                t={t}
              />
            ) : null
          }
        />
      </QueryState>
    </Screen>
  );
};

/** properties for the control that reads the next, older page */
type OlderChangesProps = {
  loading: boolean;
  failed: boolean;
  onLoad: () => void;
  t: (key: MessageKey) => string;
};

/**
 * offers older changes and reports a failed read without hiding the entries already shown
 * @param props control properties
 * @param props.loading whether the older page is being read
 * @param props.failed whether the last read of an older page failed
 * @param props.onLoad reads the older page
 * @param props.t translation function for message keys
 * @returns the footer of the history list
 */
const OlderChanges: FC<OlderChangesProps> = ({
  loading,
  failed,
  onLoad,
  t,
}) => (
  <View style={{ gap: 12 }}>
    {failed && (
      <Text
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={styles.error}>
        {t('readFailed')}
      </Text>
    )}
    <ActionButton
      secondary
      testID="record-history-load-more"
      label={loading ? t('loading') : t('olderChanges')}
      onPress={onLoad}
      disabled={loading}
    />
  </View>
);

/** properties for the notice shown when a background refresh fails */
type RefreshNoticeProps = {
  onRetry: () => void;
  t: (key: MessageKey) => string;
};

/**
 * reports a failed background refresh without hiding the entries already shown
 * @param props notice properties
 * @param props.onRetry reads the history again
 * @param props.t translation function for message keys
 * @returns a small notice with a retry action
 */
const RefreshNotice: FC<RefreshNoticeProps> = ({ onRetry, t }) => (
  <View style={[styles.row, { justifyContent: 'space-between' }]}>
    <Text
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.secondary}>
      {t('refreshFailed')}
    </Text>
    <ActionButton
      secondary
      testID="record-history-refresh-retry"
      label={t('retry')}
      onPress={onRetry}
    />
  </View>
);
