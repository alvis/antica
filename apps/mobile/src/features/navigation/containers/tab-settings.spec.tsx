import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import CollectionRoute from '../../../app/(private)/(tabs)/collection';
import KnowledgeRoute from '../../../app/(private)/(tabs)/knowledge';
import MeRoute from '../../../app/(private)/(tabs)/me';
import TodayRoute from '../../../app/(private)/(tabs)/today';
import { renderMobile, savedLanguage } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

it.each([
  { tab: 'Collection', route: <CollectionRoute /> },
  { tab: 'Today', route: <TodayRoute /> },
  { tab: 'Knowledge', route: <KnowledgeRoute /> },
])(
  'should open Settings from the $tab tab header gear in each language',
  async ({ route }) => {
    const english = await renderMobile(route, {
      get: async () => ({ items: [], hits: [], total: 0, nextCursor: null }),
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Settings' }));
    expect(english.router.push).toHaveBeenCalledWith('/settings');
    await screen.unmount();

    const traditional = await renderMobile(
      route,
      {
        get: async () => ({ items: [], hits: [], total: 0, nextCursor: null }),
      },
      savedLanguage('zh-Hant'),
    );
    await fireEvent.press(screen.getByRole('button', { name: '設定' }));
    expect(traditional.router.push).toHaveBeenCalledWith('/settings');
  },
);

it('should open research notes from the Me tab, now that research is not a tab', async () => {
  const me = await renderMobile(<MeRoute />, { get: async () => ({}) });

  await fireEvent.press(screen.getByRole('button', { name: 'Research notes' }));

  expect(me.router.push).toHaveBeenCalledWith('/research');
});
