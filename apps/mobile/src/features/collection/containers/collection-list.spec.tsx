import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import CollectionRoute from '../../../app/(private)/(tabs)/collection';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const thumbnail = 'https://media.example/cover.jpg?signature=collector-read';
const pictured = {
  ...collectionRecord,
  name: 'Blue bowl',
  coverThumbnail: thumbnail,
  locationLabel: 'Cabinet',
  pendingCheckCount: 2,
};
const unpictured = {
  ...collectionRecord,
  id: '00000000-0000-4000-8000-000000000002',
  code: 'A-002',
  coverThumbnail: null,
  locationLabel: null,
  pendingCheckCount: 0,
};

it('should show the signed cover and navigate pictured and unpictured collection rows', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async () => ({ items: [pictured, unpictured], nextCursor: null }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-001, Blue bowl' }),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('Blue bowl')).toHaveProp('source', {
    uri: thumbnail,
  });
  expect(screen.queryByLabelText('A-002')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'A-001, Blue bowl' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'A-002, Unnamed item' }),
  );
  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/collection/${pictured.id}`],
    [`/collection/${unpictured.id}`],
  ]);
});

it('should request the next collection page and restore the previous rows', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async (path) =>
      new URL(path, 'https://api.example').searchParams.has('cursor')
        ? { items: [unpictured], nextCursor: null }
        : { items: [pictured], nextCursor: 'page-two' },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'More' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'More' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-002, Unnamed item' }),
    ).toBeTruthy(),
  );
  expect(
    view.reads.mock.calls.some(
      ([path]) => path === '/v1/records?limit=50&sort=updated&cursor=page-two',
    ),
  ).toBe(true);
  expect(screen.queryByRole('button', { name: 'A-001, Blue bowl' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Previous page' }));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'A-001, Blue bowl' }),
    ).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Previous page' })).toBeNull();
});

it('should offer capture when the collection is empty', async () => {
  const view = await renderMobile(<CollectionRoute />, {
    get: async () => ({ items: [], nextCursor: null }),
  });
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'Add item' })).toHaveLength(2),
  );
  await fireEvent.press(screen.getAllByRole('button', { name: 'Add item' })[1]);
  expect(view.router.push).toHaveBeenCalledWith('/capture');
});
