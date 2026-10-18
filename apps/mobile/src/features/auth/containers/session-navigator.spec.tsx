import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';

import PrivateLayout from '../../../app/(private)/_layout';
import RootLayout from '../../../app/_layout';
import IndexRoute from '../../../app/index';
import { act, renderRouter, screen } from 'expo-router/testing-library';

import type { Dispatch, PropsWithChildren, SetStateAction } from 'react';

type MockSession = { authenticated: boolean; loading: boolean };

const mockSession: {
  initial: MockSession;
  set?: Dispatch<SetStateAction<MockSession>>;
} = { initial: { authenticated: false, loading: true } };

jest.mock('../../../providers/AuthProvider', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  const context = react.createContext<MockSession>({
    authenticated: false,
    loading: true,
  });

  return {
    AuthProvider: ({ children }: PropsWithChildren) => {
      const [value, setValue] = react.useState(() => mockSession.initial);
      mockSession.set = setValue;

      return <context.Provider value={value}>{children}</context.Provider>;
    },
    useAuth: () => react.useContext(context),
  };
});

const routes = {
  '_layout': RootLayout,
  'index': IndexRoute,
  'login': () => <Text>Login screen</Text>,
  '(private)/_layout': PrivateLayout,
  '(private)/collection': () => <Text>Collection screen</Text>,
  '(private)/collection/[recordId]': () => {
    const { recordId } = useLocalSearchParams<{ recordId: string }>();

    return <Text>Record {recordId}</Text>;
  },
};

const renderAt = async (
  initialUrl: string,
  initial: MockSession,
): Promise<{ getPathname: () => string }> => {
  mockSession.initial = initial;
  // renderRouter returns the pending render with its route accessors attached
  const view = renderRouter(routes, { initialUrl });
  await view;

  return { getPathname: () => view.getPathname() };
};

const settle = async (next: MockSession): Promise<void> =>
  act(async () => {
    mockSession.set?.(next);
    await jest.runAllTimersAsync();
  });

afterEach(() => {
  jest.useRealTimers();
});

describe('rc:SessionNavigator', () => {
  it('should cover private screens with the session loading state while the session restores', async () => {
    await renderAt('/collection', { authenticated: false, loading: true });

    expect(screen.getByLabelText('Loading session')).toBeTruthy();
    expect(screen.queryByText('Collection screen')).toBeNull();
    expect(
      screen.getByText('Collection screen', { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it('should keep a cold-start deep link once an authenticated session is restored', async () => {
    const view = await renderAt('/collection/r1', {
      authenticated: false,
      loading: true,
    });
    await settle({ authenticated: true, loading: false });

    expect(view.getPathname()).toBe('/collection/r1');
    expect(screen.getByText('Record r1')).toBeTruthy();
    expect(screen.queryByLabelText('Loading session')).toBeNull();
  });

  it('should send a cold-start deep link to login when no session is restored', async () => {
    const view = await renderAt('/collection/r1', {
      authenticated: false,
      loading: true,
    });
    await settle({ authenticated: false, loading: false });

    expect(view.getPathname()).toBe('/login');
    expect(screen.getByText('Login screen')).toBeTruthy();
    expect(
      screen.queryByText('Record r1', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('should open collection once an authenticated session is restored', async () => {
    const view = await renderAt('/collection', {
      authenticated: false,
      loading: true,
    });
    await settle({ authenticated: true, loading: false });

    expect(view.getPathname()).toBe('/collection');
    expect(screen.getByText('Collection screen')).toBeTruthy();
  });

  it('should send a signed-out collector from a private route to login', async () => {
    const view = await renderAt('/collection', {
      authenticated: false,
      loading: true,
    });
    await settle({ authenticated: false, loading: false });

    expect(view.getPathname()).toBe('/login');
    expect(screen.getByText('Login screen')).toBeTruthy();
  });

  it('should leave private routes for login when the session ends', async () => {
    const view = await renderAt('/collection', {
      authenticated: true,
      loading: false,
    });
    expect(screen.getByText('Collection screen')).toBeTruthy();
    await settle({ authenticated: false, loading: false });

    expect(view.getPathname()).toBe('/login');
  });
});
