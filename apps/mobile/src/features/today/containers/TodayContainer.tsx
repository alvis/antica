import { useRouter } from 'expo-router';

import { StyleSheet, View } from 'react-native';

import { ActionButton, theme } from '@antica/ui';

import { IconButton } from '../../../components/IconButton';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { SectionHeader } from '../../../components/SectionHeader';
import { useNow } from '../../../hooks/useNow';
import { useLocale } from '../../../providers/LocaleProvider';
import {
  formatDayHeading,
  formatRelativeDay,
  formatTimeOfDay,
} from '../../../utils/calendar';
import { recordTitle } from '../../../utils/record-title';
import { quoteFields } from '../../../utils/quote-fields';

import { useRecordCoverPhoto } from '../../collection/hooks/useRecordCoverPhoto';
import { proposalFieldName } from '../../collection/record-edit-display';

import { InboxFeatureCard } from '../components/InboxFeatureCard';
import { InboxRowCard } from '../components/InboxRowCard';
import { RecentShelf } from '../components/RecentShelf';
import { TodayEmptyCard } from '../components/TodayEmptyCard';
import { TodayGreeting } from '../components/TodayGreeting';
import { useTodayInbox } from '../hooks/useTodayInbox';

import { TodayKnowledgeContainer } from './TodayKnowledgeContainer';

import type { FC } from 'react';

import type { InboxFeatureCardProps } from '../components/InboxFeatureCard';
import type { TodayInboxItem } from '../today-inbox';

/** properties for 今天, with the moment it shows */
export type TodayContainerProps = {
  /** the current moment; defaults to the device clock, reread each minute and on return to the app */
  now?: Date;
};

const layout = StyleSheet.create({
  // the greeting, or the first-run card, sits 12 dp under the title, closer than the sections below it
  greeting: { marginTop: -theme.space[12] },
  section: { gap: theme.space[12] },
});

/**
 * 今天 (v5 home): the assistant's greeting, 等您處理, 今日知識, the recent shelf and
 * 拍攝新藏品 docked above the tabs; a new collector sees the first-run card instead
 * @param root0 screen properties
 * @param root0.now the current moment
 * @returns the 今天 tab
 */
export const TodayContainer: FC<TodayContainerProps> = ({ now: fixedNow }) => {
  const router = useRouter();
  const { t, locale } = useLocale();
  const clock = useNow();
  const now = fixedNow ?? clock;
  const inbox = useTodayInbox();
  const capture = (): void => router.push('/capture');
  const empty = !inbox.loading && !inbox.error && inbox.records.length === 0;

  return (
    <Screen
      title={t('tabToday')}
      overline={formatDayHeading(now, locale)}
      action={
        <IconButton
          testID="today-search"
          icon="search"
          label={t('todaySearchKnowledge')}
          onPress={() => router.push('/knowledge')}
        />
      }
      dock={
        empty ? undefined : (
          <ActionButton
            testID="today-capture"
            icon="camera"
            label={t('todayCaptureNew')}
            onPress={capture}
          />
        )
      }>
      <QueryState
        loading={inbox.loading}
        error={inbox.error}
        retry={inbox.retry}>
        {empty ? (
          <View style={layout.greeting}>
            <TodayEmptyCard onCapture={capture} />
          </View>
        ) : (
          <>
            <View style={layout.greeting}>
              <TodayGreeting
                hour={now.getHours()}
                waitingCount={inbox.items.length}
                state={
                  inbox.partialError
                    ? 'incomplete'
                    : inbox.settling
                      ? 'checking'
                      : 'settled'
                }
                onRetry={inbox.retry}
              />
            </View>
            {inbox.items.length > 0 && (
              <View testID="today-inbox" style={layout.section}>
                <SectionHeader
                  title={t('todayWaiting')}
                  meta={t('todayWaitingCount', { count: inbox.items.length })}
                />
                {inbox.items.map((item) => (
                  <InboxCard key={item.recordId} item={item} />
                ))}
              </View>
            )}
            {inbox.analysed && (
              <TodayKnowledgeContainer record={inbox.analysed} />
            )}
            <View style={layout.section}>
              <SectionHeader
                title={t('todayRecent')}
                links={[
                  {
                    label:
                      inbox.recordCount === null
                        ? t('todayAllRecordsUncounted')
                        : t('todayAllRecords', { count: inbox.recordCount }),
                    onPress: () => router.push('/collection'),
                    testID: 'today-all-records',
                  },
                ]}
              />
              <RecentShelf
                items={inbox.records.map(({ summary, createdAt }) => ({
                  recordId: summary.id,
                  name: recordTitle(summary.name, t('unnamed')),
                  photoUri: summary.coverThumbnail,
                  when: createdAt
                    ? formatRelativeDay(createdAt, now, locale, {
                        today: t('dayToday'),
                        yesterday: t('dayYesterday'),
                      })
                    : undefined,
                }))}
                onOpen={(recordId) =>
                  router.push(`/collection/${encodeURIComponent(recordId)}`)
                }
              />
            </View>
          </>
        )}
      </QueryState>
    </Screen>
  );
};

/**
 * the feature card for a finished analysis; its full-width photo is the record's cover at display
 * size, with the list thumbnail only until that loads
 * @param props card properties
 * @param props.item the analysis inbox item
 * @returns the feature card
 */
const AnalysisInboxCard: FC<
  Omit<InboxFeatureCardProps, 'name' | 'photoUri'> & {
    item: Extract<TodayInboxItem, { kind: 'analysis' }>;
  }
> = ({ item, ...card }) => {
  const cover = useRecordCoverPhoto(item.recordId);

  return (
    <InboxFeatureCard
      {...card}
      name={item.name}
      photoUri={cover ?? item.coverThumbnail}
    />
  );
};

/**
 * renders one inbox card for what waits on a record
 * @param props card properties
 * @param props.item the inbox item
 * @returns the feature card for a finished analysis, a row card otherwise
 */
const InboxCard: FC<{ item: TodayInboxItem }> = ({ item }) => {
  const router = useRouter();
  const { t, locale } = useLocale();
  const record = `/collection/${encodeURIComponent(item.recordId)}`;
  const testID = `today-inbox-${item.kind}-${item.recordId}`;
  switch (item.kind) {
    case 'analysis':
      return (
        <AnalysisInboxCard
          testID={testID}
          item={item}
          chip={t('todayAnalysisDone')}
          time={
            item.completedAt
              ? formatTimeOfDay(item.completedAt, locale)
              : undefined
          }
          summary={t(
            item.suggestionCount === item.totalCount
              ? 'todayAnalysisUntouched'
              : 'todayAnalysisWaiting',
            { count: item.suggestionCount, citations: item.citationCount },
          )}
          linkLabel={t('todayReviewEach')}
          onPress={() =>
            router.push(`/analysis/${encodeURIComponent(item.runId)}`)
          }
        />
      );
    case 'editCard':
      return (
        <InboxRowCard
          testID={testID}
          name={item.name}
          photoUri={item.coverThumbnail}
          chip={t('todayEditCardChip', { count: item.changeCount })}
          chipTone="danger"
          why={t('todayEditCardWhy', {
            fields: quoteFields(
              item.fields.map((field) => proposalFieldName(field, t)),
              t,
            ),
          })}
          onOpen={() => router.push(`${record}/messages`)}
        />
      );
    default:
      return (
        <InboxRowCard
          testID={testID}
          name={item.name}
          photoUri={item.coverThumbnail}
          chip={t('todayRetakeChip')}
          chipTone="warning"
          why={item.action.reason}
          onOpen={() => router.push(record)}
          capture={{
            label: t('todayRetakeCamera', {
              instruction: item.action.instruction,
            }),
            onPress: () =>
              router.push(
                `/capture?recordId=${encodeURIComponent(item.recordId)}`,
              ),
          }}
        />
      );
  }
};
