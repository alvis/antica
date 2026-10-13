import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { Redirect } from 'expo-router';

import { ApiTransport } from '@antica/client';

import PrivateLayout from '../../app/(private)/_layout';
import IndexRoute from '../../app/index';
import { useAuth } from '../../auth';

jest.mock(
  '../../auth',
  () =>
    ({
      useAuth: jest.fn<typeof import('../../auth').useAuth>(),
    }) satisfies Partial<typeof import('../../auth')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      Redirect: jest.fn<typeof import('expo-router').Redirect>(() => null),
      Stack: Object.assign(
        jest.fn(() => {
          const { Text } =
            jest.requireActual<typeof import('react-native')>('react-native');

          return <Text>Private collection</Text>;
        }),
        jest.requireActual<typeof import('expo-router')>('expo-router').Stack,
      ),
    }) satisfies Partial<typeof import('expo-router')>,
);

const authValue = {
  api: new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  }),
  authenticated: false,
  loading: false,
  phone: null,
  refresh: async () => undefined,
  signOut: async () => undefined,
  expire: () => undefined,
} satisfies ReturnType<typeof useAuth>;
jest.mocked(useAuth).mockReturnValue(authValue);

describe('Session navigation', () => {
  it('should wait for session restoration before choosing the entry route', async () => {
    jest.mocked(useAuth).mockReturnValueOnce({ ...authValue, loading: true });
    await render(<IndexRoute />);
    expect(screen.getByLabelText('Loading session')).toBeTruthy();
    expect(Redirect).not.toHaveBeenCalled();
  });

  it('should send a signed-out collector to login and an authenticated collector to collection', async () => {
    await render(<IndexRoute />);
    expect(jest.mocked(Redirect).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ href: '/login' }),
    );
    jest
      .mocked(useAuth)
      .mockReturnValueOnce({ ...authValue, authenticated: true });
    await render(<IndexRoute />);
    expect(jest.mocked(Redirect).mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ href: '/collection' }),
    );
  });

  it('should guard private screens until session restoration completes', async () => {
    jest.mocked(useAuth).mockReturnValueOnce({ ...authValue, loading: true });
    await render(<PrivateLayout />);
    expect(screen.getByLabelText('Loading session')).toBeTruthy();
    expect(screen.queryByText('Private collection')).toBeNull();
  });

  it('should send unauthenticated private navigation to login', async () => {
    await render(<PrivateLayout />);
    expect(jest.mocked(Redirect).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ href: '/login' }),
    );
  });

  it('should show private navigation for an authenticated collector', async () => {
    jest
      .mocked(useAuth)
      .mockReturnValueOnce({ ...authValue, authenticated: true });
    await render(<PrivateLayout />);
    expect(screen.getByText('Private collection')).toBeTruthy();
  });
});
