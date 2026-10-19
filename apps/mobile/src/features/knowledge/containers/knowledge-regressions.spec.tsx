import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { ApiError } from '@antica/client';

import KnowledgeRoute from '../../../app/(private)/(tabs)/knowledge';
import KnowledgeDetailRoute from '../../../app/(private)/knowledge/[entryId]';
import { renderMobile } from '../../../mobile.spec.fixtures';

import { hit } from '../components/knowledge.spec.fixtures';

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

const maximumQueryCodePoints = 160;
const pastQueryLimit = maximumQueryCodePoints + 1;

it('should restart a canceled blank search when text is erased before debounce settles', async () => {
  let reads = 0;
  const view = await renderMobile(<KnowledgeRoute />, {
    get: async (path) => {
      if (path.includes('/topics?')) {
        return topicsPage;
      }
      reads += 1;
      if (reads === 1) {
        return new Promise(() => undefined);
      }

      return searchPage;
    },
  });

  await waitFor(() => expect(reads).toBe(1));
  await fireEvent.changeText(screen.getByLabelText('Search'), 'chair');
  await fireEvent.changeText(screen.getByLabelText('Search'), '');
  await waitFor(() =>
    expect(screen.getByTestId(`knowledge-result-${hit.id}`)).toBeTruthy(),
  );
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(
    view.reads.mock.calls.filter(([path]) =>
      path.includes('/knowledge/search?'),
    ),
  ).toHaveLength(reads);
});

it('should clamp search text at 160 Unicode code points without splitting characters', async () => {
  await renderMobile(<KnowledgeRoute />, {
    get: async (path) => (path.includes('/topics?') ? topicsPage : searchPage),
  });

  const search = screen.getByLabelText('Search');
  await fireEvent.changeText(search, 'x'.repeat(pastQueryLimit));
  expect(search).toHaveProp('value', 'x'.repeat(maximumQueryCodePoints));
  await fireEvent.changeText(search, '🪑'.repeat(pastQueryLimit));
  expect(search).toHaveProp('value', '🪑'.repeat(maximumQueryCodePoints));
  expect([...screen.getByLabelText('Search').props.value]).toHaveLength(
    maximumQueryCodePoints,
  );
});

it('should reload the newer working revision after a saved-view conflict and retain typed edits', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'saved' });
  const saved = { ...knowledgeEntry, revision: 1 };
  const working = { ...knowledgeEntry, revision: 2 };
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => (path.includes('view=working') ? working : saved),
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-edit')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-edit'));
  await fireEvent.changeText(
    screen.getByLabelText('Original title'),
    'My revised chair',
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
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reload latest revision' }),
  );
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) => path.includes('view=working')),
    ).toBe(true),
  );
  expect(screen.getByLabelText('Original title')).toHaveDisplayValue(
    'My revised chair',
  );
  await waitFor(() =>
    expect(screen.queryByTestId('knowledge-save-conflict')).toBeNull(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-save'));
  await waitFor(() =>
    expect(screen.getByTestId('knowledge-save-success')).toBeTruthy(),
  );
  expect(view.patches.mock.calls[1]?.[2].body).toEqual(
    expect.objectContaining({ expectedRevision: 2, status: 'saved' }),
  );
});

it('should keep a conflict and typed edits if the working revision cannot be reloaded', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ entryId: hit.id, view: 'saved' });
  const view = await renderMobile(<KnowledgeDetailRoute />, {
    get: async (path) => {
      if (path.includes('view=working')) {
        throw new Error('Offline');
      }

      return knowledgeEntry;
    },
  });

  await waitFor(() =>
    expect(screen.getByTestId('knowledge-edit')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('knowledge-edit'));
  await fireEvent.changeText(
    screen.getByLabelText('Original title'),
    'Offline revision',
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
  await fireEvent.press(
    screen.getByRole('button', { name: 'Reload latest revision' }),
  );
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) => path.includes('view=working')),
    ).toBe(true),
  );
  expect(screen.getByTestId('knowledge-save-conflict')).toBeTruthy();
  expect(screen.getByLabelText('Original title')).toHaveDisplayValue(
    'Offline revision',
  );
  expect(screen.getByTestId('knowledge-save')).toHaveProp(
    'accessibilityState',
    { disabled: true },
  );
});
