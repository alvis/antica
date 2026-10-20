import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgeResultCard } from './KnowledgeResultCard';

import type { FC } from 'react';

import type { useKnowledgeSearch } from '../hooks/useKnowledgeSearch';

interface ResultsProps {
  entries: ReturnType<typeof useKnowledgeSearch>;
  hasFilters: boolean;
  onOpen: (id: string) => void;
}
/**
 * renders retained result rows, settled counts and cursor controls
 * @param props search state and explicit read action
 * @param props.entries retained discovery query
 * @param props.hasFilters whether explicit search constraints are active
 * @param props.onOpen opens the selected entry
 * @returns search results and feedback
 */
export const KnowledgeSearchResults: FC<ResultsProps> = ({
  entries,
  hasFilters,
  onOpen,
}) => {
  const { t } = useLocale();
  const first = entries.data?.pages[0];

  return (
    <>
      <KnowledgeInitialState entries={entries} />
      {entries.isFetching && entries.data && (
        <Text style={styles.secondary}>{t('knowledgeRefresh')}</Text>
      )}
      {first && !entries.isFetching && (
        <Text accessibilityLiveRegion="polite" style={styles.secondary}>
          {t('knowledgeResultCount', { count: first.total })}
        </Text>
      )}
      {first?.hits.length === 0 && (
        <Text
          testID={hasFilters ? 'knowledge-no-results' : 'knowledge-empty'}
          style={styles.body}>
          {t(hasFilters ? 'knowledgeNoResults' : 'knowledgeNoContent')}
        </Text>
      )}
      {entries.data?.pages
        .flatMap((page) => page.hits)
        .map((hit) => (
          <KnowledgeResultCard
            key={hit.id}
            hit={hit}
            onOpen={() => onOpen(hit.id)}
          />
        ))}
      <KnowledgeRetainedError entries={entries} />
      {entries.hasNextPage && (
        <ActionButton
          testID="knowledge-more"
          label={t('more')}
          disabled={entries.isFetching}
          onPress={() => {
            void entries.fetchNextPage();
          }}
          secondary
        />
      )}
    </>
  );
};
/**
 * displays a reserved loading skeleton or the first-page failure
 * @param props search query
 * @param props.entries retained discovery query
 * @returns initial feedback
 */
const KnowledgeInitialState: FC<Pick<ResultsProps, 'entries'>> = ({
  entries,
}) => {
  const { t } = useLocale();

  return (
    <>
      {entries.isPending && (
        <View testID="knowledge-loading">
          <Text style={styles.secondary}>{t('loading')}</Text>
          {[0, 1, 2].map((key) => (
            <View
              key={key}
              accessible={false}
              style={[styles.card, { minHeight: 96, opacity: 0.4 }]}>
              <View
                style={{ height: 16, backgroundColor: '#6D746B', width: '70%' }}
              />
              <View
                style={{ height: 16, backgroundColor: '#6D746B', width: '90%' }}
              />
            </View>
          ))}
        </View>
      )}
      {entries.isError && !entries.data && (
        <View testID="knowledge-error">
          <Text accessibilityRole="alert" style={styles.error}>
            {t('knowledgeLoadError')}
          </Text>
          <ActionButton
            testID="knowledge-retry"
            label={t('retry')}
            onPress={() => {
              void entries.refetch();
            }}
          />
        </View>
      )}
    </>
  );
};
/**
 * keeps existing rows usable after a failed refresh or next page
 * @param props search query
 * @param props.entries retained discovery query
 * @returns retry feedback
 */
const KnowledgeRetainedError: FC<Pick<ResultsProps, 'entries'>> = ({
  entries,
}) => {
  const { t } = useLocale();

  return (
    <>
      {entries.isError && entries.data && (
        <View
          testID={
            entries.isFetchNextPageError
              ? 'knowledge-pagination-error'
              : 'knowledge-error'
          }>
          <Text accessibilityRole="alert" style={styles.error}>
            {t(
              entries.isFetchNextPageError
                ? 'knowledgeNextPageError'
                : 'knowledgeLoadError',
            )}
          </Text>
          <ActionButton
            testID="knowledge-retry"
            label={t('retry')}
            onPress={() => {
              void (entries.isFetchNextPageError
                ? entries.fetchNextPage()
                : entries.refetch());
            }}
          />
        </View>
      )}
    </>
  );
};
