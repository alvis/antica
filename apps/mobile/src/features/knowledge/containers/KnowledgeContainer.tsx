import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { knowledgeSearchQuerySchema } from '@antica/contracts';
import { ActionButton, TextField } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgeBrowse } from '../components/KnowledgeBrowse';
import { KnowledgeFilters } from '../components/KnowledgeFilters';
import { KnowledgeSearchResults } from '../components/KnowledgeSearchResults';
import { useKnowledgeSearch } from '../hooks/useKnowledgeSearch';
import { useKnowledgeSelection } from '../hooks/useKnowledgeSelection';
import { useKnowledgeTopics } from '../hooks/useKnowledgeTopics';

import type { FC } from 'react';

import type { KnowledgeSearchSelection } from '../hooks/useKnowledgeSearch';

/** the whole saved library, unfiltered */
const librarySelection: KnowledgeSearchSelection = {
  query: '',
  view: 'saved',
};

/**
 * keeps browse choices and results mounted while a detail route is pushed
 * @returns the knowledge discovery screen
 */
export const KnowledgeContainer: FC = () => {
  const { t } = useLocale();
  const router = useRouter();
  const state = useKnowledgeSelection();
  const entries = useKnowledgeSearch(state.selection);
  const taxonomy = useKnowledgeTopics(state.topicId, state.filtersOpen);
  // the saved library's size, from the same unfiltered search the screen opens with
  const library = useKnowledgeSearch(librarySelection);
  const libraryTotal = library.data?.pages[0]?.total;

  return (
    <Screen
      title={t('tabKnowledge')}
      overline={
        libraryTotal === undefined
          ? undefined
          : t('knowledgeOverline', { count: libraryTotal })
      }>
      <View testID="knowledge-search">
        <TextField
          label={t('search')}
          value={state.selection.query}
          onChangeText={state.setQuery}
        />
      </View>
      <KnowledgeBrowse {...state} {...taxonomy} />
      <FilterControls {...state} {...taxonomy} entries={entries} />
      <KnowledgeSearchResults
        entries={entries}
        hasFilters={state.hasFilters}
        onOpen={(id) =>
          router.push(`/knowledge/${id}?view=${state.selection.view}`)
        }
      />
      <ActionButton
        label={t('importBook')}
        onPress={() => router.push('/sources/new')}
        secondary
      />
    </Screen>
  );
};
/**
 * expands every explicit facet group without inferring hidden choices
 * @param props browse state and current facet responses
 * @returns expandable facet alternatives with an explicit reset
 */
const FilterControls: FC<
  ReturnType<typeof useKnowledgeSelection> &
    ReturnType<typeof useKnowledgeTopics> & {
      entries: ReturnType<typeof useKnowledgeSearch>;
    }
> = (props) => {
  const { locale, t } = useLocale();
  const {
    selection,
    filtersOpen,
    setFiltersOpen,
    groups,
    entries,
    toggleTopic,
    toggleValue,
    clear,
  } = props;
  const { query: queryText, ...searchFilters } = selection;

  return (
    <>
      <ActionButton
        label={t(filtersOpen ? 'knowledgeHideFilters' : 'knowledgeShowFilters')}
        onPress={() => setFiltersOpen((value) => !value)}
        secondary
      />
      {filtersOpen && (
        <>
          {groups.some((group) => group.isError) && (
            <ActionButton
              label={t('retry')}
              onPress={() => {
                for (const group of groups) {
                  if (group.isError) {
                    void group.refetch();
                  }
                }
              }}
            />
          )}
          <KnowledgeFilters
            options={groups.map((group) => group.data ?? [])}
            facets={entries.data?.pages[0]?.facets ?? []}
            selection={knowledgeSearchQuerySchema.parse({
              ...searchFilters,
              q: queryText,
              locale,
              limit: 20,
            })}
            onTopic={toggleTopic}
            onValue={toggleValue}
            onClear={clear}
          />
        </>
      )}
    </>
  );
};
