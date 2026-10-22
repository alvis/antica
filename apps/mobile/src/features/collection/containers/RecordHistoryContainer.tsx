import { useInfiniteQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { FlatList, StyleSheet, Text, View } from 'react-native';

import { ActionButton, styles, theme } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';
import { formatDateTime } from '../../../utils/calendar';

import { historySourceRoute, recordHistoryQuery } from '../api/record-history';
import {
  HistoryEvent,
  RecordHistoryEntry,
} from '../components/RecordHistoryEntry';
import { RecordSegmentScreen } from '../components/RecordSegmentScreen';
import { useRecordHub } from '../hooks/useRecordHub';

import { RecordSegmentHeaderContainer } from './RecordSegmentHeaderContainer';

import type { FC, ReactElement } from 'react';

import type { RecordHistoryEntry as HistoryEntry } from '@antica/contracts';

import type { MessageKey, Translate } from '../../../i18n/messages';

import type { RecordHub } from '../hooks/useRecordHub';

/** properties for a record's change history screen */
export type RecordHistoryContainerProps = { recordId: string };

/** one event of the 紀錄 timeline */
type TimelineItem =
  | { kind: 'change'; id: string; at: string; entry: HistoryEntry }
  | { kind: 'analysis'; id: string; at: string; runId: string }
  | { kind: 'created'; id: string; at: string };

const layout = StyleSheet.create({
  list: { flex: 1 },
  content: {
    marginVertical: theme.space.section,
    marginHorizontal: theme.space.page,
    paddingLeft: 22,
  },
  footer: { gap: theme.space[12] },
});

/**
 * lays out the timeline: the changes the history holds, the latest analysis and the record's
 * creation, newest first; events older than the last change read wait until the history is read
 * to the end, so they never land between pages
 * @param entries the changes read so far, newest first
 * @param hub the record and its latest analysis
 * @param complete whether every page of changes is read
 * @returns the timeline's events
 */
function timeline(
  entries: readonly HistoryEntry[],
  hub: RecordHub,
  complete: boolean,
): TimelineItem[] {
  const record = hub.record.data;
  const run = hub.run.data;
  const oldest = entries.at(-1)?.occurredAt;
  const events: TimelineItem[] = [
    ...(run && hub.runCompletedAt
      ? [
          {
            kind: 'analysis' as const,
            id: `analysis-${run.runId}`,
            at: hub.runCompletedAt,
            runId: run.runId,
          },
        ]
      : []),
    ...(record
      ? [{ kind: 'created' as const, id: 'created', at: record.createdAt }]
      : []),
  ].filter(
    (event) =>
      complete ||
      oldest === undefined ||
      Date.parse(event.at) >= Date.parse(oldest),
  );

  return [
    ...entries
      .filter((entry) => entry.status === 'accepted')
      .map((entry) => ({
        kind: 'change' as const,
        id: entry.id,
        at: entry.occurredAt,
        entry,
      })),
    ...events,
  ].sort((left, right) => Date.parse(right.at) - Date.parse(left.at));
}

/**
 * the 紀錄 segment (v5 `history`): every change to the record on a timeline, newest first, each
 * with the way back to the analysis or conversation it came from
 * @param props screen properties
 * @param props.recordId record whose history is shown
 * @returns the segment
 */
export const RecordHistoryContainer: FC<RecordHistoryContainerProps> = ({
  recordId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { locale, t } = useLocale();
  const hub = useRecordHub(recordId);
  const history = useInfiniteQuery(recordHistoryQuery(api, recordId));
  const entries = history.data?.pages.flatMap((page) => page.items) ?? [];
  const items = timeline(entries, hub, !history.hasNextPage);
  const run = hub.run.data;
  const media = hub.fieldLabels.media.filter(
    (detail) => detail.asset.purpose === 'object',
  );

  const renderItem = ({
    item,
    index,
  }: {
    item: TimelineItem;
    index: number;
  }): ReactElement => {
    const time = formatDateTime(item.at, locale);
    const edge = { first: index === 0, last: index === items.length - 1 };
    if (item.kind === 'change') {
      const route = historySourceRoute(recordId, item.entry.source);

      return (
        <RecordHistoryEntry
          entry={item.entry}
          locale={locale}
          t={t}
          edge={edge}
          onOpenSource={route ? () => router.replace(route) : undefined}
        />
      );
    }
    if (item.kind === 'analysis') {
      const proposals = run?.result.output?.proposedChanges.length ?? 0;
      const decided =
        run?.result.proposalStates.filter((state) => state.status !== 'pending')
          .length ?? 0;
      const citations = run?.citations.length ?? 0;

      return (
        <HistoryEvent
          testID={`record-history-analysis-${item.runId}`}
          edge={edge}
          time={time}
          title={
            decided === 0
              ? t('historyAnalysedNone', { count: proposals })
              : t('historyAnalysedSome', { count: proposals, decided })
          }
          body={
            citations > 0
              ? t('historyCitations', { count: citations })
              : undefined
          }
          link={{
            label: t('historyOpenAnalysis'),
            onPress: () =>
              router.replace(`/analysis/${encodeURIComponent(item.runId)}`),
            testID: `record-history-analysis-${item.runId}-source`,
          }}
        />
      );
    }

    return (
      <HistoryEvent
        testID="record-history-created"
        edge={edge}
        time={time}
        title={t('historyCreated')}
        body={createdBody(media, t)}
      />
    );
  };

  return (
    <RecordSegmentScreen
      testID="record-history-screen"
      header={
        <RecordSegmentHeaderContainer
          recordId={recordId}
          current="history"
          subtitle={
            // v5 counts every event on the timeline, the analysis and creation included
            items.length > 0
              ? t('historySubtitle', { count: items.length })
              : undefined
          }
        />
      }>
      <QueryState
        loading={history.isPending}
        // a failed older page keeps the entries already shown
        error={history.data ? null : history.error}
        retry={() => void history.refetch()}>
        <FlatList
          testID="record-history"
          accessibilityLabel={t('changeHistory')}
          style={layout.list}
          data={items}
          keyExtractor={(item) => item.id}
          contentContainerStyle={layout.content}
          ListHeaderComponent={
            history.isRefetchError ? (
              <RefreshNotice onRetry={() => void history.refetch()} t={t} />
            ) : null
          }
          renderItem={renderItem}
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
    </RecordSegmentScreen>
  );
};

/**
 * says what the record started with (v5 「6 張照片、1 段影片」)
 * @param media the record's object photos and videos
 * @param t translator
 * @returns the line, or nothing before the media are read
 */
function createdBody(
  media: RecordHub['fieldLabels']['media'],
  t: Translate,
): string | undefined {
  const photos = media.filter((detail) => detail.asset.kind === 'photo').length;
  const videos = media.filter((detail) => detail.asset.kind === 'video').length;
  if (photos === 0 && videos === 0) {
    return undefined;
  }
  const parts = [
    photos > 0 ? t('historyPhotos', { count: photos }) : '',
    videos > 0 ? t('historyVideos', { count: videos }) : '',
  ].filter(Boolean);

  return parts.join(t('listSeparator'));
}

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
  <View style={layout.footer}>
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
