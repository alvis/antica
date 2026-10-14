import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getItemAsync } from 'expo-secure-store';

import CollectionRoute from '../../app/(private)/(tabs)/collection';
import { renderMobile } from '../../mobile.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const categoryId = '00000000-0000-4000-8000-000000000041';
const materialId = '00000000-0000-4000-8000-000000000042';
const periodId = '00000000-0000-4000-8000-000000000043';
const locationId = '00000000-0000-4000-8000-000000000044';

/**
 * returns collection, location, and taxonomy responses for the filter journey
 * @param path requested API path
 * @returns response body for the requested collection endpoint
 */
async function getCollectionFilterResponse(path: string): Promise<unknown> {
  if (path === '/v1/locations') {
    return [{ id: locationId, label: 'Cabinet' }];
  }
  if (path.startsWith('/v1/knowledge?')) {
    const kind = new URL(path, 'https://api.example').searchParams.get('kinds');

    return {
      items: [
        kind === 'material'
          ? { id: materialId, titleZhHant: 'Porcelain' }
          : kind === 'period'
            ? { id: periodId, titleZhHant: 'Qing' }
            : { id: categoryId, titleZhHant: 'Ceramic' },
      ],
      nextCursor: null,
    };
  }

  return { items: [], nextCursor: null };
}

it('should combine and clear collection taxonomy, location, tag, pending, and sort filters', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: getCollectionFilterResponse,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ceramic' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Ceramic' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Material' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Porcelain' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Porcelain' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Porcelain' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Period' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Qing' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Qing' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Qing' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Cabinet' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Cabinet' }));
  await fireEvent.changeText(screen.getByLabelText('Tags'), '  glaze  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Pending checks' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Item code' }));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) => {
        if (!path.startsWith('/v1/records?')) {
          return false;
        }
        const parameters = new URL(path, 'https://api.example').searchParams;

        return (
          parameters.get('categoryIds') === categoryId &&
          parameters.get('materialIds') === materialId &&
          parameters.get('periodIds') === periodId &&
          parameters.get('locationId') === locationId &&
          parameters.get('tags') === 'glaze' &&
          parameters.get('hasPendingChecks') === 'true' &&
          parameters.get('sort') === 'code'
        );
      }),
    ).toBe(true),
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() => {
    const latestPath = view.reads.mock.calls
      .filter(([path]) => path.startsWith('/v1/records?'))
      .at(-1)?.[0];
    const parameters = new URL(latestPath ?? '', 'https://api.example')
      .searchParams;
    expect(parameters.get('sort')).toBe('code');
    expect(parameters.has('categoryIds')).toBe(false);
    expect(parameters.has('materialIds')).toBe(false);
    expect(parameters.has('periodIds')).toBe(false);
    expect(parameters.has('locationId')).toBe(false);
    expect(parameters.has('tags')).toBe(false);
    expect(parameters.has('hasPendingChecks')).toBe(false);
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Recently updated' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Name' }));
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) => path === '/v1/records?limit=50&sort=name',
      ),
    ).toBe(true),
  );
});

it('should search trimmed text and select freshness without offering duplicate capture on no matches', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async () => ({ items: [], nextCursor: null }),
  });
  await waitFor(() =>
    expect(
      screen.getByText('Your collection is empty. Add an item to begin.'),
    ).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Search'), '  bowl  ');
  await waitFor(() =>
    expect(
      screen.getByText(
        'No items match these filters. Clear filters to see your collection.',
      ),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: 'All' }),
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Not analyzed' }));
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: 'Not analyzed' }),
  ]);
  await fireEvent.press(
    screen.getByRole('button', { name: 'New evidence not analyzed' }),
  );
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: 'New evidence not analyzed' }),
  ]);
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(
        ([path]) =>
          path.includes('text=bowl') && path.includes('freshness=outdated'),
      ),
    ).toBe(true),
  );
  await fireEvent.changeText(screen.getByLabelText('Search'), '');
  await waitFor(() =>
    expect(
      screen.getByText(
        'No items match these filters. Clear filters to see your collection.',
      ),
    ).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'All' }));
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: 'All' }),
  ]);
  await waitFor(() =>
    expect(
      screen.getByText('Your collection is empty. Add an item to begin.'),
    ).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
  await fireEvent.press(screen.getAllByRole('button', { name: 'Add item' })[0]);
  expect(view.router.push).toHaveBeenCalledWith('/settings');
  expect(view.router.push).toHaveBeenCalledWith('/capture');
});

it('should search filter terms and keep the selected category only once', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async (path) =>
      path.startsWith('/v1/knowledge?')
        ? {
            items: [{ id: categoryId, titleZhHant: 'Ceramic' }],
            nextCursor: null,
          }
        : path === '/v1/locations'
          ? []
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Filters' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await fireEvent.changeText(screen.getAllByLabelText('Search')[0], 'celadon');
  await waitFor(() =>
    expect(
      view.reads.mock.calls.some(([path]) =>
        path.includes('/v1/knowledge?q=celadon&limit=50&kinds=object_type'),
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ceramic' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Ceramic' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Ceramic' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Material' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Object type' }));
  await waitFor(() => {
    const latestPath = view.reads.mock.calls
      .filter(([path]) => path.startsWith('/v1/records?'))
      .at(-1)?.[0];
    expect(
      new URL(latestPath ?? '', 'https://api.example').searchParams.getAll(
        'categoryIds',
      ),
    ).toEqual([categoryId]);
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Pending checks' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Pending checks' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  expect(screen.queryByRole('button', { name: 'Ceramic' })).toBeNull();
  expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(
    1,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() =>
    expect(
      screen.getByText('Your collection is empty. Add an item to begin.'),
    ).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
});

it('should retry a collection read error and restore the collection rows', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ items: [], nextCursor: null }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      screen.getByText('Your collection is empty. Add an item to begin.'),
    ).toBeTruthy(),
  );
  expect(view.reads.mock.calls.map(([path]) => path)).toEqual([
    '/v1/records?limit=50&sort=updated',
    '/v1/records?limit=50&sort=updated',
  ]);
});

it('should expose the selected freshness and recover filtered results in Traditional Chinese', async () => {
  jest.mocked(getItemAsync).mockResolvedValueOnce('zh-Hant');
  await renderMobile(<CollectionRoute />, {
    get: async (path) => ({
      items: new URL(path, 'https://api.example').searchParams.has('freshness')
        ? []
        : [
            {
              id: categoryId,
              code: 'A-041',
              name: 'Collector-authored bowl',
              coverThumbnail: null,
              locationLabel: null,
              analysisFreshness: 'current',
              pendingCheckCount: 0,
            },
          ],
      nextCursor: null,
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-041, Collector-authored bowl' }),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: '全部' }),
  ]);
  await fireEvent.press(screen.getByRole('button', { name: '尚未分析' }));
  await waitFor(() =>
    expect(
      screen.getByText('沒有符合篩選條件的藏品。清除篩選即可查看藏品。'),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: '尚未分析' }),
  ]);
  expect(
    screen.queryByRole('button', { name: 'A-041, Collector-authored bowl' }),
  ).toBeNull();
  expect(screen.getAllByRole('button', { name: '新增藏品' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: '新證據尚未分析' }));
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: '新證據尚未分析' }),
  ]);
  await fireEvent.press(
    await screen.findByRole('button', { name: '清除篩選' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-041, Collector-authored bowl' }),
    ).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: '全部' }),
  ]);
  expect(
    screen.queryByText('沒有符合篩選條件的藏品。清除篩選即可查看藏品。'),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: '清除篩選' })).toBeNull();
});

it('should clear nonmatching collection search from expanded filters and restore the existing row', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async (path) => {
      if (!path.startsWith('/v1/records?')) {
        return getCollectionFilterResponse(path);
      }

      return {
        items: new URL(path, 'https://api.example').searchParams.has('text')
          ? []
          : [
              {
                id: categoryId,
                code: 'A-041',
                name: 'Collector-authored bowl',
                coverThumbnail: null,
                locationLabel: null,
                analysisFreshness: 'current',
                pendingCheckCount: 0,
              },
            ],
        nextCursor: null,
      };
    },
  });
  const rowName = 'A-041, Collector-authored bowl';
  await waitFor(() =>
    expect(screen.getByRole('button', { name: rowName })).toBeTruthy(),
  );
  const search = screen.getByLabelText('Search');
  await fireEvent.changeText(search, 'no-such-item');
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: rowName })).toBeNull(),
  );
  expect(
    view.reads.mock.calls.some(([path]) => path.includes('text=no-such-item')),
  ).toBe(true);
  await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Ceramic' })).toBeTruthy(),
  );
  expect(search).toHaveDisplayValue('no-such-item');
  expect(screen.getAllByRole('button', { name: 'Clear filters' })).toHaveLength(
    1,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
  expect(search).toHaveDisplayValue('');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: rowName })).toBeTruthy(),
  );
  expect(screen.getAllByRole('button', { selected: true })).toEqual([
    screen.getByRole('button', { name: 'All' }),
  ]);
  expect(screen.getByRole('button', { name: 'Ceramic' })).toBeTruthy();
});

it('should distinguish current and outdated items, including an unnamed photo', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async () => ({
      items: [
        {
          id: '00000000-0000-4000-8000-000000000045',
          code: 'A-045',
          name: null,
          coverThumbnail: 'https://media.example/unnamed.jpg',
          locationLabel: null,
          analysisFreshness: 'outdated',
          pendingCheckCount: 0,
        },
        {
          id: '00000000-0000-4000-8000-000000000046',
          code: 'A-046',
          name: 'Tea bowl',
          coverThumbnail: null,
          locationLabel: 'Cabinet',
          analysisFreshness: 'current',
          pendingCheckCount: 0,
        },
      ],
      nextCursor: null,
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-045, Unnamed item' }),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('A-045')).toHaveProp('source', {
    uri: 'https://media.example/unnamed.jpg',
  });
  expect(screen.getAllByText('New evidence not analyzed')).toHaveLength(2);
  expect(screen.getByText('Saved')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: 'A-046, Tea bowl' }),
  );
  expect(view.router.push).toHaveBeenCalledWith(
    '/collection/00000000-0000-4000-8000-000000000046',
  );
});
