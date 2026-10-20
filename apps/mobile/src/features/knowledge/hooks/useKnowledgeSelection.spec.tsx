import { expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { topic } from '../components/knowledge.spec.fixtures';

import {
  toggleKnowledgeTopic,
  toggleKnowledgeValue,
  useKnowledgeSelection,
} from './useKnowledgeSelection';

import type { ReactElement, ReactNode } from 'react';

const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
  <LocaleProvider preferences={savedPreferences('en')}>
    {children}
  </LocaleProvider>
);

it('should retain text while choosing and clearing a topic path', async () => {
  const { result } = await renderHook(useKnowledgeSelection, { wrapper });

  await act(() =>
    result.current.setSelection((current) => ({ ...current, query: 'chair' })),
  );
  await act(() => result.current.choose(topic));
  expect(result.current.topicId).toBe(topic.id);
  expect(result.current.selection.topics?.category).toEqual([topic.id]);
  expect(result.current.hasFilters).toBe(true);

  await act(() => result.current.clear());
  expect(result.current.topicId).toBeNull();
  expect(result.current.selection.query).toBe('chair');
  expect(result.current.selection.topics).toBeUndefined();

  await act(() =>
    result.current.setSelection((current) => ({ ...current, query: ' ' })),
  );
  expect(result.current.hasFilters).toBe(false);
});

it('should toggle OR values within a facet and preserve other facet choices', async () => {
  const { result } = await renderHook(useKnowledgeSelection, { wrapper });
  const material = {
    ...topic,
    id: '00000000-0000-4000-8000-000000000062',
    facet: 'material' as const,
  };
  const anotherMaterial = {
    ...material,
    id: '00000000-0000-4000-8000-000000000063',
  };

  await act(() => result.current.toggleTopic(material));
  await act(() => result.current.toggleTopic(anotherMaterial));
  expect(result.current.selection.topics?.material).toEqual([
    material.id,
    anotherMaterial.id,
  ]);
  await act(() => result.current.toggleTopic(material));
  expect(result.current.selection.topics?.material).toEqual([
    anotherMaterial.id,
  ]);
  await act(() => result.current.toggleTopic(anotherMaterial));
  expect(result.current.selection.topics?.material).toBeUndefined();

  await act(() => result.current.toggleValue('providers', 'The Met'));
  await act(() =>
    result.current.toggleValue('providers', 'Cleveland Museum of Art'),
  );
  await act(() => result.current.toggleValue('languages', 'zh-Hant'));
  expect(result.current.selection.providers).toEqual([
    'The Met',
    'Cleveland Museum of Art',
  ]);
  expect(result.current.selection.languages).toEqual(['zh-Hant']);
  await act(() => result.current.toggleValue('providers', 'The Met'));
  expect(result.current.selection.providers).toEqual([
    'Cleveland Museum of Art',
  ]);
  expect(result.current.selection.languages).toEqual(['zh-Hant']);
  expect(result.current.hasFilters).toBe(true);
});

it('should keep the previous selection when a facet choice violates the shared search contract', () => {
  const previous = { query: 'chair', view: 'saved' as const };

  expect(
    toggleKnowledgeTopic(previous, { ...topic, id: 'invalid-topic-id' }),
  ).toBe(previous);
  expect(
    toggleKnowledgeValue(previous, {
      locale: 'en',
      key: 'providers',
      // eslint-disable-next-line @typescript-eslint/no-magic-numbers -- Exceeds the shared facet length bound.
      value: 'p'.repeat(1_000),
    }),
  ).toBe(previous);
});
