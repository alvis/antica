import { Text } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgeChoice } from './KnowledgeChoice';
import { TopicBrowse } from './TopicBrowse';

import type { FC } from 'react';

import type { useKnowledgeSelection } from '../hooks/useKnowledgeSelection';
import type { useKnowledgeTopics } from '../hooks/useKnowledgeTopics';

type BrowseProps = ReturnType<typeof useKnowledgeTopics> &
  ReturnType<typeof useKnowledgeSelection>;
/**
 * presents category roots and an explicit saved/working selection
 * @param props retained selection and taxonomy reads
 * @returns category and status controls
 */
export const KnowledgeBrowse: FC<BrowseProps> = (props) => {
  const { t } = useLocale();
  const { groups, selection, setSelection, choose } = props;

  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('knowledgeBrowseTopics')}
      </Text>
      <QueryState
        loading={groups[0]?.isPending ?? false}
        error={groups[0]?.error ?? null}
        retry={() => {
          void groups[0].refetch();
        }}>
        <TopicBrowse
          category
          topics={
            groups[0]?.data?.filter((topic) => topic.parentId === null) ?? []
          }
          selected={selection.topics?.category ?? []}
          onSelect={choose}
        />
      </QueryState>
      <KnowledgeChoice
        selected={selection.view === 'saved'}
        testID="knowledge-status-saved"
        label={t('knowledgeSaved')}
        onPress={() =>
          setSelection((previous) => ({ ...previous, view: 'saved' }))
        }
      />
      <KnowledgeChoice
        selected={selection.view === 'working'}
        testID="knowledge-status-draft"
        label={t('knowledgeDrafts')}
        onPress={() =>
          setSelection((previous) => ({ ...previous, view: 'working' }))
        }
      />
      {selection.view === 'working' && (
        <Text style={styles.secondary}>{t('knowledgeWorkingHint')}</Text>
      )}
      <KnowledgeTopicPath {...props} />
    </>
  );
};
/**
 * presents ancestors and paginated direct children
 * @param props current taxonomy path and selection action
 * @param props.topicId current path identity
 * @param props.tree paginated ancestor and child query
 * @param props.choose topic selection action
 * @param props.openPath opens a related topic path
 * @returns topic controls or no path at the category roots
 */
const KnowledgeTopicPath: FC<BrowseProps> = (props) => {
  const { topicId, tree, choose, openPath } = props;
  const { t } = useLocale();
  const pages = tree.data?.pages ?? [];
  const path = pages.at(0);
  if (!topicId) {
    return null;
  }

  return (
    <QueryState
      loading={tree.isPending}
      error={tree.error}
      retry={() => {
        void tree.refetch();
      }}>
      {path && (
        <>
          <TopicBrowse
            topics={[...path.ancestors, path.topic]}
            selected={[topicId]}
            onSelect={choose}
          />
          <TopicBrowse
            topics={pages.flatMap((page) => page.descendants)}
            selected={[topicId]}
            onSelect={choose}
          />
          {path.related.length > 0 && (
            <>
              <Text style={styles.secondary}>
                {t('knowledgeRelatedTopics')}
              </Text>
              {path.related.map((topic) => (
                <KnowledgeChoice
                  key={topic.id}
                  label={topic.label}
                  selected={topic.id === topicId}
                  onPress={() => openPath(topic.id)}
                />
              ))}
            </>
          )}
          {tree.hasNextPage && (
            <ActionButton
              label={t('more')}
              disabled={tree.isFetchingNextPage}
              onPress={() => {
                void tree.fetchNextPage();
              }}
              secondary
            />
          )}
        </>
      )}
    </QueryState>
  );
};
