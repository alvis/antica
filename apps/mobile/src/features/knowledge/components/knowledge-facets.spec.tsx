import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { knowledgeSearchQuerySchema } from '@antica/contracts';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { topic } from './knowledge.spec.fixtures';
import { KnowledgeFilters } from './KnowledgeFilters';

it('should retain selected values absent from facet counts and label every entry kind', async () => {
  const onValue = jest.fn();
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <KnowledgeFilters
        options={[[topic]]}
        selection={knowledgeSearchQuerySchema.parse({
          q: '',
          locale: 'en',
          limit: 20,
          view: 'saved',
          providers: ['Unlisted museum'],
          entryTypes: ['method', 'concept'],
        })}
        facets={[
          { facet: 'entryType', id: 'object_example', count: 2 },
          { facet: 'language', id: 'en', count: 1 },
        ]}
        onTopic={jest.fn()}
        onValue={onValue}
        onClear={jest.fn()}
      />
    </LocaleProvider>,
  );

  expect(screen.getByText('Museum example (2)')).toBeTruthy();
  expect(screen.getByText('Method (0)')).toBeTruthy();
  expect(screen.getByText('Concept (0)')).toBeTruthy();
  expect(screen.getByText('Unlisted museum (0)')).toBeTruthy();
  expect(screen.getAllByText('No available values').length).toBeGreaterThan(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Method (0)' }));
  expect(onValue).toHaveBeenCalledWith('entryTypes', 'method');
});
