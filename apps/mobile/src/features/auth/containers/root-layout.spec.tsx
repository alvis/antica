import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

import { Redirect } from 'expo-router';

import RootLayout from '../../../app/_layout';
import { authClient } from '../../../providers/AuthProvider';

jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock('better-auth/client/plugins', () => ({
  phoneNumberClient: () => ({}),
}));
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    getSession: jest.fn(async () => ({ data: null, error: null })),
    getCookie: () => '',
    signOut: jest.fn(async () => ({ data: { success: true }, error: null })),
  }),
}));
jest.mock(
  'expo-router',
  () =>
    ({
      Redirect: jest.fn<typeof import('expo-router').Redirect>(() => null),
      // the root ask sheet reads the router; nothing in these tests opens it
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      Stack: Object.assign(
        jest.fn(() => {
          const { Text } =
            jest.requireActual<typeof import('react-native')>('react-native');
          const { default: Entry } =
            jest.requireActual<typeof import('../../../app/index')>(
              '../../../app/index',
            );
          const { useLocale } = jest.requireActual<
            typeof import('../../../providers/LocaleProvider')
          >('../../../providers/LocaleProvider');
          const { t } = useLocale();

          return (
            <>
              <Text>{t('privateCollection')}</Text>
              <Entry />
            </>
          );
        }),
        jest.requireActual<typeof import('expo-router')>('expo-router').Stack,
      ),
    }) satisfies Partial<typeof import('expo-router')>,
);

describe('rc:RootLayout', () => {
  it('should present the signed-out route in Traditional Chinese on a new installation', async () => {
    await render(<RootLayout />);

    expect(screen.getByText('您的私人藏品與研究')).toBeTruthy();
    await waitFor(() =>
      expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ href: '/login' }),
      ),
    );
  });

  it('should leave the development language link out of release builds', async () => {
    const developmentBuild = __DEV__;
    Reflect.set(globalThis, '__DEV__', false);
    try {
      await render(<RootLayout />);

      expect(screen.getByText('您的私人藏品與研究')).toBeTruthy();
      await waitFor(() =>
        expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual(
          expect.objectContaining({ href: '/login' }),
        ),
      );
    } finally {
      Reflect.set(globalThis, '__DEV__', developmentBuild);
    }
  });

  it('should present the collection route after restoring the collector session', async () => {
    jest.mocked(authClient.getSession).mockResolvedValueOnce({
      data: {
        session: { id: 'session-1' },
        user: { phoneNumber: '+85212345678' },
      },
      error: null,
    });
    await render(<RootLayout />);

    await waitFor(() =>
      expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ href: '/collection' }),
      ),
    );
  });
});
