import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { ApiError } from '@antica/client';

import KnowledgeRoute from '../../../app/(private)/(tabs)/knowledge';
import KnowledgeDetailRoute from '../../../app/(private)/knowledge/[entryId]';
import { renderMobile, savedLanguage } from '../../../mobile.spec.fixtures';

import {
  citation,
  claim,
  hit,
  topic,
} from '../components/knowledge.spec.fixtures';

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

it('should browse a category and search in both scripts with Saved selected by default', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) =>
      path.includes('/topics/')
        ? topicTree
        : path.includes('/topics?')
          ? topicsPage
          : searchPage,
  });

  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-category-${topic.id}`)).toBeTruthy(),
  );
  expect(screen.getByTestId('knowledge-status-saved')).toBeTruthy();
  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  expect(
    view.reads.mock.calls.some(
      ([path]) =>
        path.includes('/knowledge/search?') && path.includes('view=saved'),
    ),
  ).toBe(true);

  await fireEvent.press(screen.getByTestId(`knowledge-category-${topic.id}`));
  await waitFor(() => expect(screen.getByText('Glazes')).toBeTruthy());
  await fireEvent.changeText(screen.getByLabelText('Search'), '黃花梨');
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) =>
        path.includes('q=%E9%BB%83%E8%8A%B1%E6%A2%A8'),
      ),
    ).toBe(true),
  );
  await fireEvent.changeText(screen.getByLabelText('Search'), 'huanghuali');
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) => path.includes('q=huanghuali')),
    ).toBe(true),
  );

  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/knowledge/${hit.id}?view=saved`,
  );
});

it('should switch explicitly to working drafts and retry a failed first page', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }
      throw new Error('Offline');
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-error')).toBeTruthy(),
  );
  expect(screen.queryByText('Offline')).toBeNull();
  view.reads.mockImplementation(async (path) =>
    path.includes('/topics?') ? topicsPage : searchPage,
  );
  await fireEvent.press(screen.getByTestId('knowledge-retry'));
  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-status-draft'));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('/knowledge/search?') && path.includes('view=working'),
      ),
    ).toBe(true),
  );
});

it('should load cursor pages for search and topic browse without replacing visible results', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics/') && path.includes('cursor=children')) {
        return { ...topicTree, descendants: [], nextCursor: null };
      }
      if (path.includes('/topics/')) {
        return { ...topicTree, nextCursor: 'children' };
      }
      if (path.includes('/topics?') && path.includes('cursor=roots')) {
        return { ...topicsPage, items: [], nextCursor: null };
      }
      if (path.includes('/topics?')) {
        return { ...topicsPage, nextCursor: 'roots' };
      }

      return path.includes('cursor=entries')
        ? { ...searchPage, hits: [], nextCursor: null }
        : { ...searchPage, nextCursor: 'entries' };
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-more')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-more'));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('/knowledge/search?') &&
          path.includes('cursor=entries'),
      ),
    ).toBe(true),
  );
  expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`knowledge-category-${topic.id}`));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('/topics/') && path.includes('cursor=children'),
      ),
    ).toBe(false),
  );
  await waitFor(() =>
    expect(
      screen.getAllByRole('button', { name: 'More' }).length,
    ).toBeGreaterThan(0),
  );
  await fireEvent.press(screen.getAllByRole('button', { name: 'More' })[0]);
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('/topics/') && path.includes('cursor=children'),
      ),
    ).toBe(true),
  );
});

it('should expose every facet and keep earlier results after next-page failure', async () => {
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }
      if (path.includes('cursor=entries')) {
        throw new Error('Next page unavailable');
      }

      return { ...searchPage, nextCursor: 'entries' };
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-more')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Show filters' }));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-filters')).toBeTruthy(),
  );
  expect(screen.getByTestId('knowledge-facet-provenance')).toBeTruthy();
  expect(screen.getByTestId('knowledge-facet-provider')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Cleveland Museum of Art (1)' }),
  );
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('/knowledge/search?') &&
          path.includes('providers=Cleveland+Museum+of+Art'),
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-more')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-more'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-pagination-error')).toBeTruthy(),
  );
  expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy();
});

it('should read translated claims and captured citations without saving on open', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'saved' });
  const view = await renderMobile(
    <KnowledgeDetailRoute />,
    { get: async () => knowledgeEntry },
    savedLanguage('en'),
  );

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-detail')).toBeTruthy(),
  );
  expect(screen.getByText('The huanghuali surface is dark.')).toBeTruthy();
  expect(view.patches).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByTestId(`knowledge-citation-${claim.claimKey}-${citation.id}`),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId(`knowledge-citation-panel-${citation.id}`),
    ).toBeTruthy(),
  );
  expect(screen.getByText(citation.quote)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  await fireEvent.press(screen.getByTestId('knowledge-language-original'));
  expect(screen.getByText(claim.originalText)).toBeTruthy();
  expect(view.patches).not.toHaveBeenCalled();
});

it('should keep typed edits through a revision conflict and save only on explicit review action', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'saved' });
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => knowledgeEntry,
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-edit')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-edit'));
  await fireEvent.changeText(
    screen.getByLabelText('Original title'),
    'Revised chair',
  );
  await fireEvent.changeText(
    screen.getByLabelText('Summary'),
    'Revised summary',
  );
  view.patches.mockRejectedValueOnce(
    new ApiError({
      status: 409,
      code: 'REVISION_CONFLICT',
      message: 'Revision changed',
    }),
  );
  await fireEvent.press(screen.getByTestId('knowledge-save'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-save-conflict')).toBeTruthy(),
  );
  expect(screen.getByLabelText('Original title')).toHaveDisplayValue(
    'Revised chair',
  );
  expect(screen.getByLabelText('Summary')).toHaveDisplayValue(
    'Revised summary',
  );
  expect(view.patches.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({ expectedRevision: 3, status: 'saved' }),
  );
});

it('should retry an ordinary save error with the same request identity and show success', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'working' });
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async () => knowledgeEntry,
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-save')).toBeTruthy(),
  );
  view.patches.mockRejectedValueOnce(new Error('Temporary failure'));
  await fireEvent.press(screen.getByTestId('knowledge-save'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-save-error')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-save'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-save-success')).toBeTruthy(),
  );
  expect(
    view.patches.mock.calls.map(([, , options]) => options.idempotencyKey),
  ).toEqual([
    view.patches.mock.calls[0]?.[2].idempotencyKey,
    view.patches.mock.calls[0]?.[2].idempotencyKey,
  ]);
  expect(
    view.reads.mock.calls.some(([path]) =>
      path.includes(`/${hit.id}?view=working`),
    ),
  ).toBe(true);
});
