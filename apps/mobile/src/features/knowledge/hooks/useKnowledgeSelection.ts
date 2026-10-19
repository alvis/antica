import { useState } from 'react';

import { knowledgeSearchQuerySchema } from '@antica/contracts';

import { useLocale } from '../../../providers/LocaleProvider';

import type { Dispatch, SetStateAction } from 'react';

import type {
  KnowledgeSearchQuery,
  KnowledgeTopicSummary,
} from '@antica/contracts';

import type { KnowledgeSearchSelection } from './useKnowledgeSearch';

type ValueFacet = 'providers' | 'languages' | 'entryTypes';
interface KnowledgeSelectionState {
  selection: KnowledgeSearchSelection;
  setQuery: (query: string) => void;
  setSelection: Dispatch<SetStateAction<KnowledgeSearchSelection>>;
  topicId: string | null;
  openPath: Dispatch<SetStateAction<string | null>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  choose: (topic: KnowledgeTopicSummary) => void;
  toggleTopic: (topic: KnowledgeTopicSummary) => void;
  toggleValue: (key: ValueFacet, value: string) => void;
  clear: () => void;
  hasFilters: boolean;
}
const maximumQueryCodePoints = 160;
const initialSelection: KnowledgeSearchSelection = { query: '', view: 'saved' };
/**
 * retains explicit browse choices while the list route remains mounted
 * @returns selection and user actions
 */
export function useKnowledgeSelection(): KnowledgeSelectionState {
  const { locale } = useLocale();
  const [selection, setSelection] = useState(initialSelection);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const choose = (topic: KnowledgeTopicSummary): void => {
    setTopicId(topic.id);
    setSelection((previous) => ({
      ...previous,
      topics: { ...previous.topics, [topic.facet]: [topic.id] },
    }));
  };
  const toggleTopic = (topic: KnowledgeTopicSummary): void =>
    setSelection((previous) => toggleKnowledgeTopic(previous, topic));
  const toggleValue = (key: ValueFacet, value: string): void =>
    setSelection((previous) =>
      toggleKnowledgeValue(previous, { locale, key, value }),
    );
  const clear = (): void => {
    setSelection((previous) => ({
      query: previous.query,
      view: previous.view,
    }));
    setTopicId(null);
  };
  const hasFilters = [
    selection.query.trim().length,
    Object.keys(selection.topics ?? {}).length,
    selection.providers?.length ?? 0,
    selection.languages?.length ?? 0,
    selection.entryTypes?.length ?? 0,
  ].some(Boolean);

  return {
    selection,
    setQuery: (query) =>
      setSelection((previous) => ({
        ...previous,
        query: [...query].slice(0, maximumQueryCodePoints).join(''),
      })),
    setSelection,
    topicId,
    openPath: setTopicId,
    filtersOpen,
    setFiltersOpen,
    choose,
    toggleTopic,
    toggleValue,
    clear,
    hasFilters,
  };
}
/**
 * toggles one OR topic in a facet
 * @param previous current choices
 * @param topic selected topic
 * @returns updated choices
 */
export function toggleKnowledgeTopic(
  previous: KnowledgeSearchSelection,
  topic: KnowledgeTopicSummary,
): KnowledgeSearchSelection {
  const selected = previous.topics?.[topic.facet] ?? [];
  const values = selected.includes(topic.id)
    ? selected.filter((id) => id !== topic.id)
    : [...selected, topic.id];
  const topics = { ...previous.topics };
  if (values.length) {
    topics[topic.facet] = values;
  } else {
    delete topics[topic.facet];
  }

  return knowledgeSearchQuerySchema.shape.topics.safeParse(topics).success
    ? { ...previous, topics }
    : previous;
}

/**
 * toggles one shared-contract value
 * @param previous current choices
 * @param input shared facet choice
 * @param input.locale current interface language
 * @param input.key backend facet selection key
 * @param input.value requested alternative
 * @returns validated choices
 */
export function toggleKnowledgeValue(
  previous: KnowledgeSearchSelection,
  {
    locale,
    key,
    value,
  }: { locale: KnowledgeSearchQuery['locale']; key: ValueFacet; value: string },
): KnowledgeSearchSelection {
  const selected: readonly string[] = previous[key] ?? [];
  const values = selected.includes(value)
    ? selected.filter((id) => id !== value)
    : [...selected, value];
  const { query: previousQuery, ...previousFilters } = previous;
  const result = knowledgeSearchQuerySchema.safeParse({
    ...previousFilters,
    q: previousQuery,
    locale,
    limit: 20,
    [key]: values,
  });
  if (!result.success) {
    return previous;
  }
  const parsed = result.data;
  const filters = {
    topics: parsed.topics,
    view: parsed.view,
    providers: parsed.providers,
    languages: parsed.languages,
    entryTypes: parsed.entryTypes,
  };

  return { ...filters, query: previous.query };
}
