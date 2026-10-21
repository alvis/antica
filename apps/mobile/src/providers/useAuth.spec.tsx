import { describe, expect, it, jest } from '@jest/globals';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { deleteItemAsync, getItemAsync } from 'expo-secure-store';

import { AuthProvider, authClient, useAuth } from './AuthProvider';

import type { RenderHookResult } from '@testing-library/react-native';

import type { FC, PropsWithChildren } from 'react';

jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      deleteItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('better-auth/client/plugins', () => ({
  phoneNumberClient: () => ({}),
}));
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    getSession: jest.fn(async () => ({ data: null, error: null })),
    getCookie: () => 'session=collector',
    signOut: jest.fn(async () => ({ data: { success: true }, error: null })),
  }),
}));

const authenticatedSession = {
  data: {
    session: {
      id: 'session-1',
      token: 'token-1',
      userId: 'collector-1',
      expiresAt: new Date('2027-01-01'),
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      ipAddress: null,
      userAgent: null,
    },
    user: {
      id: 'collector-1',
      name: 'Collector',
      email: 'collector@example.com',
      emailVerified: false,
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      phoneNumber: '+85212345678',
      phoneNumberVerified: true,
      image: null,
    },
  },
  error: null,
};

/**
 * provides the query cache and session provider of the app root, with private data cached
 * @returns the wrapper and the cache it provides
 */
function appRoot(): { wrapper: FC<PropsWithChildren>; cache: QueryClient } {
  const cache = new QueryClient();
  cache.setQueryData(['records'], { items: ['private'] });
  const wrapper: FC<PropsWithChildren> = ({ children }) => (
    <QueryClientProvider client={cache}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );

  return { wrapper, cache };
}

describe('hk:useAuth', () => {
  it('should reject use without an authentication provider', async () => {
    await expect(renderHook(useAuth)).rejects.toThrow();
  });

  it('should restore an authenticated collector and remove local identity after logout', async () => {
    const { view, cache } = await restoreCollector();
    expect(cache.getQueryData(['records'])).toEqual({ items: ['private'] });
    await act(async () => view.result.current.signOut());
    expect({
      authenticated: view.result.current.authenticated,
      phone: view.result.current.phone,
      userId: view.result.current.userId,
    }).toEqual({ authenticated: false, phone: null, userId: null });
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(cache.getQueryData(['records'])).toBeUndefined();
  });

  it('should sign the device out and clear private data when the server cannot end the session', async () => {
    const { view, cache } = await restoreCollector();
    const failure = new Error('Offline');
    jest.mocked(authClient.signOut).mockRejectedValueOnce(failure);

    await act(async () => {
      await expect(view.result.current.signOut()).rejects.toBe(failure);
    });

    expect(view.result.current.authenticated).toBe(false);
    expect(cache.getQueryData(['records'])).toBeUndefined();
  });

  it('should leave sign-in available when session restoration fails', async () => {
    jest
      .mocked(authClient.getSession)
      .mockRejectedValueOnce(new Error('Offline'));
    const { wrapper, cache } = appRoot();
    try {
      const view = await renderHook(useAuth, { wrapper });
      await waitFor(() =>
        expect({
          authenticated: view.result.current.authenticated,
          loading: view.result.current.loading,
          phone: view.result.current.phone,
        }).toEqual({
          authenticated: false,
          loading: false,
          phone: null,
        }),
      );
      await act(async () => view.result.current.refresh());
      expect(view.result.current.authenticated).toBe(false);
      // nobody was signed in, so nothing ended
      expect(cache.getQueryData(['records'])).toEqual({ items: ['private'] });
    } finally {
      cache.clear();
    }
  });
});

it('should stop an existing transport from using the cookie after sign-out', async () => {
  const { view } = await restoreCollector();
  const api = view.result.current.api;
  await act(async () => view.result.current.signOut());
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response('{}'));
  await api.get('/v1/records', { parse: (value: unknown) => value });
  expect(request.mock.calls[0]?.[1]?.headers).toMatchObject({ Cookie: '' });
});

it('should clear the previous owner’s queries when refreshing into another account', async () => {
  const { view, cache } = await restoreCollector();
  jest.mocked(authClient.getSession).mockResolvedValueOnce({
    ...authenticatedSession,
    data: {
      ...authenticatedSession.data,
      user: { ...authenticatedSession.data.user, id: 'collector-2' },
    },
  });
  await act(async () => view.result.current.refresh());
  expect(view.result.current.userId).toBe('collector-2');
  expect(cache.getQueryData(['records'])).toBeUndefined();
});

describe('Session expiry', () => {
  it('should clear restored identity when the API rejects its session cookie', async () => {
    const request = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ code: 'SESSION_EXPIRED', message: 'Expired' }),
            { status: 401 },
          ),
      );
    const { view, cache } = await restoreCollector();
    await act(async () => {
      await expect(
        view.result.current.api.get('/v1/records', {
          parse: (value: unknown) => value,
        }),
      ).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' });
    });
    expect({
      authenticated: view.result.current.authenticated,
      phone: view.result.current.phone,
      userId: view.result.current.userId,
    }).toEqual({ authenticated: false, phone: null, userId: null });
    expect(cache.getQueryData(['records'])).toBeUndefined();
    expect(request).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: 'session=collector' }),
      }),
    );
  });

  it('should remove authenticated identity when explicitly expired', async () => {
    const { view, cache } = await restoreCollector();
    await act(async () => view.result.current.expire());
    expect({
      authenticated: view.result.current.authenticated,
      phone: view.result.current.phone,
      userId: view.result.current.userId,
    }).toEqual({ authenticated: false, phone: null, userId: null });
    expect(cache.getQueryData(['records'])).toBeUndefined();
  });
});

it('should settle loading after an expired mount refresh is discarded', async () => {
  const pending = Promise.withResolvers<typeof authenticatedSession>();
  jest.mocked(authClient.getSession).mockReturnValueOnce(pending.promise);
  const { wrapper } = appRoot();
  const view = await renderHook(useAuth, { wrapper });
  expect(view.result.current.loading).toBe(true);

  await act(async () => view.result.current.expire());
  await act(async () => pending.resolve(authenticatedSession));

  expect({
    loading: view.result.current.loading,
    authenticated: view.result.current.authenticated,
    userId: view.result.current.userId,
  }).toEqual({ loading: false, authenticated: false, userId: null });
});

it('should restore a fresh sign-in when an anonymous request returns 401 during its refresh', async () => {
  const { wrapper } = appRoot();
  const view = await renderHook(useAuth, { wrapper });
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  const pendingSession = Promise.withResolvers<typeof authenticatedSession>();
  jest
    .mocked(authClient.getSession)
    .mockReturnValueOnce(pendingSession.promise);
  const pendingResponse = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => {
      started.resolve();

      return pendingResponse.promise;
    });
  const signingIn = view.result.current.refresh();
  const anonymous = view.result.current.api.get('/v1/records', {
    parse: (value: unknown) => value,
  });
  await started.promise;

  await act(async () => {
    pendingResponse.resolve(new Response('{}', { status: 401 }));
    await expect(anonymous).rejects.toMatchObject({ status: 401 });
    pendingSession.resolve(authenticatedSession);
    await signingIn;
  });

  expect({
    authenticated: view.result.current.authenticated,
    userId: view.result.current.userId,
  }).toEqual({ authenticated: true, userId: 'collector-1' });
  expect(request).toHaveBeenCalledTimes(1);
});

it('should delete durable cookies and every chunk family even when server sign-out fails', async () => {
  const { view, cache } = await restoreCollector();
  const persisted = new Map([
    ['antica_cookie', 'session=collector'],
    ['antica_cookie.0', 'legacy-first'],
    ['antica_cookie.1', ''],
    ['antica_cookie.2', 'legacy-last'],
    ['antica_cookie.0.0', 'slot-zero-first'],
    ['antica_cookie.0.1', ''],
    ['antica_cookie.0.2', 'slot-zero-last'],
    ['antica_cookie.1.0', 'slot-one-first'],
    ['antica_cookie.1.1', ''],
    ['antica_cookie.1.2', 'slot-one-last'],
    ['preferences', 'keep'],
  ]);
  jest
    .mocked(getItemAsync)
    .mockImplementation(async (key) => persisted.get(key) ?? null);
  jest.mocked(deleteItemAsync).mockImplementation(async (key) => {
    persisted.delete(key);
  });
  const failure = new Error('Offline');
  jest.mocked(authClient.signOut).mockRejectedValueOnce(failure);

  await act(async () => {
    await expect(view.result.current.signOut()).rejects.toBe(failure);
  });

  expect([...persisted]).toEqual([['preferences', 'keep']]);
  expect(view.result.current.authenticated).toBe(false);
  expect(cache.getQueryData(['records'])).toBeUndefined();
});

/**
 * restores a fresh provider instance for tests that mutate collector identity
 * @returns mounted authenticated provider, its public hook state and the app query cache
 */
async function restoreCollector(): Promise<{
  view: RenderHookResult<ReturnType<typeof useAuth>, unknown>;
  cache: QueryClient;
}> {
  jest
    .mocked(authClient.getSession)
    .mockResolvedValueOnce(authenticatedSession);
  const { wrapper, cache } = appRoot();
  const view = await renderHook(useAuth, { wrapper });
  await waitFor(() =>
    expect({
      authenticated: view.result.current.authenticated,
      loading: view.result.current.loading,
      phone: view.result.current.phone,
      userId: view.result.current.userId,
    }).toEqual({
      authenticated: true,
      loading: false,
      phone: '+85212345678',
      userId: 'collector-1',
    }),
  );

  return { view, cache };
}
