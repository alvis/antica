import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import KnowledgeRoute from '../../../app/(private)/(tabs)/knowledge';
import KnowledgeDetailRoute from '../../../app/(private)/knowledge/[entryId]';
import { renderMobile } from '../../../mobile.spec.fixtures';

import { hit, topic } from '../components/knowledge.spec.fixtures';

import {
  knowledgeEntry,
  searchPage,
  topicTree,
  topicsPage,
} from './knowledge-journey.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should show an empty corpus and recover category roots after a taxonomy failure', async () => {
  let categoryAttempts = 0;
  await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        categoryAttempts += 1;
        if (categoryAttempts === 1) {
          throw new Error('Taxonomy offline');
        }

        return topicsPage;
      }

      return { ...searchPage, hits: [], total: 0 };
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-empty')).toBeTruthy(),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-category-${topic.id}`)).toBeTruthy(),
  );
  expect(categoryAttempts).toBeGreaterThan(1);
});

it('should retry a failed topic path and open a related path without losing results', async () => {
  const related = {
    ...topic,
    id: '00000000-0000-4000-8000-000000000072',
    label: 'Related glaze',
  };
  let treeAttempts = 0;
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics/') && !path.includes('/topics?')) {
        treeAttempts += 1;
        if (treeAttempts === 1) {
          throw new Error('Topic offline');
        }

        return { ...topicTree, related: [related] };
      }

      return path.includes('/topics?') ? topicsPage : searchPage;
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-category-${topic.id}`)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId(`knowledge-category-${topic.id}`));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: related.label })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: related.label }));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) =>
        path.includes(`/topics/${related.id}/tree`),
      ),
    ).toBe(true),
  );
  expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy();
});

it('should expose draft and rejected reading states without topic assignments', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'working' });
  const entry = {
    ...knowledgeEntry,
    status: 'draft' as const,
    savedBy: null,
    content: {
      ...knowledgeEntry.content,
      entryType: 'method' as const,
      titles: [{ language: 'en' as const, text: 'Surface method' }],
      topics: [],
      editorialReview: { state: 'rejected' as const },
    },
  };
  await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => (path.includes('/topics?') ? topicsPage : entry),
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-detail')).toBeTruthy(),
  );
  expect(screen.getByText(/Drafts.*Rejected/)).toBeTruthy();
  expect(screen.queryByText('Museum example')).toBeNull();
  expect(screen.queryByText('Related topics')).toBeNull();
  await fireEvent.press(screen.getByTestId('knowledge-language-translated'));
  expect(screen.getByText('The huanghuali surface is dark.')).toBeTruthy();
});

it('should recover topic labels after an entry taxonomy failure', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'saved' });
  let categoryAttempts = 0;
  await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        if (path.includes('facet=category')) {
          categoryAttempts += 1;
          if (categoryAttempts === 1) {
            throw new Error('Taxonomy offline');
          }
        }

        return topicsPage;
      }

      return knowledgeEntry;
    },
  });

  await waitFor(() => expect(screen.getByText('Related topics')).toBeTruthy());
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(categoryAttempts).toBeGreaterThan(1));
  expect(screen.getByText(topic.label)).toBeTruthy();
});

it('should retry a failed cursor page while retaining existing search rows', async () => {
  let pageAttempts = 0;
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }
      if (path.includes('cursor=next')) {
        pageAttempts += 1;
        if (pageAttempts === 1) {
          throw new Error('Later page offline');
        }

        return { ...searchPage, hits: [], nextCursor: null };
      }

      return { ...searchPage, nextCursor: 'next' };
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-more')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-more'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-pagination-error')).toBeTruthy(),
  );
  expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('knowledge-retry'));
  await waitFor(() => expect(pageAttempts).toBeGreaterThan(1));
  await waitFor(() =>
    expect(screen.queryByTestId('knowledge-pagination-error')).toBeNull(),
  );
  expect(
    view.reads.mock.calls.some(([path]) => path.includes('cursor=next')),
  ).toBe(true);
});

it('should recover a retained first-page refresh without dropping its visible row', async () => {
  let searchAttempts = 0;
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }
      searchAttempts += 1;
      if (searchAttempts === 2) {
        throw new Error('Refresh offline');
      }

      return searchPage;
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  await act(async () => {
    await view.client.invalidateQueries({ queryKey: ['knowledge-search'] });
  });
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-error')).toBeTruthy(),
  );
  expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId('knowledge-retry'));
  await waitFor(() => expect(searchAttempts).toBeGreaterThan(2));
  await waitFor(() =>
    expect(screen.queryByTestId('knowledge-error')).toBeNull(),
  );
});

it('should retry a facet, clear filters, and open import from the knowledge tab', async () => {
  let materialAttempts = 0;
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        if (path.includes('facet=material')) {
          materialAttempts += 1;
          if (materialAttempts === 1) {
            throw new Error('Facet offline');
          }
        }

        return topicsPage;
      }

      return searchPage;
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-status-draft'));
  expect(
    screen.getByText('Drafts includes current saved revisions.'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('knowledge-status-saved'));
  await fireEvent.press(screen.getByRole('button', { name: 'Show filters' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(materialAttempts).toBeGreaterThan(1));
  await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Hide filters' }));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Import book or page' }),
  );
  expect(view.router.push).toHaveBeenCalledWith('/sources/new');
});

it('should head the knowledge tab with the saved library size', async () => {
  await renderMobile(<KnowledgeRoute />, {
    get: async (path) =>
      path.includes('/topics?') ? topicsPage : { ...searchPage, total: 56 },
  });

  expect(
    await screen.findByText(
      '56 entries · three museums and Wikidata · every line cited',
    ),
  ).toBeTruthy();
});
