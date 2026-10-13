import { describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react-native';

import { Redirect } from 'expo-router';

import RootLayout from '../../app/_layout';
import { authClient } from '../../auth';

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
      Stack: Object.assign(
        jest.fn(() => {
          const { Text } =
            jest.requireActual<typeof import('react-native')>('react-native');
          const { default: Entry } =
            jest.requireActual<typeof import('../../app/index')>(
              '../../app/index',
            );
          const { useLocale } =
            jest.requireActual<typeof import('../../locale')>('../../locale');
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
  it('should restore a private session before presenting the signed-out route', async () => {
    await render(<RootLayout />);

    expect(
      screen.getByText('Your private collection and research'),
    ).toBeTruthy();
    await waitFor(() =>
      expect(jest.mocked(Redirect).mock.calls.at(-1)?.[0]).toEqual(
        expect.objectContaining({ href: '/login' }),
      ),
    );
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
