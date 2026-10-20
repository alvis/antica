import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import KnowledgeRoute from '../../../app/(private)/(tabs)/knowledge';
import KnowledgeDetailRoute from '../../../app/(private)/knowledge/[entryId]';
import { renderMobile } from '../../../mobile.spec.fixtures';

import { hit, image, topic } from '../components/knowledge.spec.fixtures';

import {
  knowledgeEntry,
  searchPage,
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

it('should distinguish an empty corpus from a constrained search with no matches', async () => {
  await renderMobile(<KnowledgeRoute />, {
    get: async (path) =>
      path.includes('/topics?')
        ? topicsPage
        : { ...searchPage, hits: [], total: 0 },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-empty')).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Search'), 'missing chair');
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-no-results')).toBeTruthy(),
  );
  expect(screen.queryByTestId('knowledge-empty')).toBeNull();
});

it('should offer empty facet groups while the first search page is unavailable', async () => {
  await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return path.includes('facet=category')
          ? topicsPage
          : { ...topicsPage, items: [] };
      }

      throw new Error('Search offline');
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-error')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Show filters' }));
  expect(screen.getByTestId('knowledge-filters')).toBeTruthy();
  expect(
    (await screen.findAllByText('No available values')).length,
  ).toBeGreaterThan(0);
});

it('should retry an entry read and expose the gallery only after recovery', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    entryId: hit.id,
    view: 'saved',
  });
  let attempts = 0;
  await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }

      attempts += 1;
      if (attempts === 1) {
        throw new Error('Entry offline');
      }

      return knowledgeEntry;
    },
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-detail')).toBeTruthy(),
  );
  expect(attempts).toBeGreaterThan(1);

  const gallery = screen.getByTestId('knowledge-detail');
  const galleryProps = gallery.props as {
    onViewableItemsChanged: (event: {
      viewableItems: Array<{ item: typeof image }>;
    }) => void;
    renderItem: (event: { item: typeof image }) => {
      props: { nearViewport: boolean; caption: string };
    };
  };
  await act(async () => {
    galleryProps.onViewableItemsChanged({ viewableItems: [{ item: image }] });
  });
  const latestProps = screen.getByTestId('knowledge-detail')
    .props as typeof galleryProps;
  const visible = latestProps.renderItem({ item: image });
  expect(visible.props.nearViewport).toBe(true);
  expect(visible.props.caption).toBe('黃花梨 chair');
});

it('should show pending review and topic uncertainty as reading text', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    entryId: hit.id,
    view: 'saved',
  });
  const entry = {
    ...knowledgeEntry,
    content: {
      ...knowledgeEntry.content,
      editorialReview: { state: 'pending' as const },
      topics: [
        {
          topicId: topic.id,
          applicability: 'specific' as const,
          uncertainty: 'Tentative',
        },
      ],
    },
  };
  await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => (path.includes('/topics?') ? topicsPage : entry),
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-detail')).toBeTruthy(),
  );
  expect(screen.getByText(/Saved.*Pending review/)).toBeTruthy();
  expect(screen.getByText(/Ceramics.*Tentative/)).toBeTruthy();
});
