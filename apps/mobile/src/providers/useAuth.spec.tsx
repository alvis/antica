import { describe, expect, it, jest } from '@jest/globals';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { AuthProvider, authClient, useAuth } from './AuthProvider';

import type { RenderHookResult } from '@testing-library/react-native';

import type { FC, PropsWithChildren } from 'react';

jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
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
    }).toEqual({ authenticated: false, phone: null });
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
  });
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
    }).toEqual({ authenticated: false, phone: null });
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
    }).toEqual({ authenticated: false, phone: null });
    expect(cache.getQueryData(['records'])).toBeUndefined();
  });
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
    }).toEqual({ authenticated: true, loading: false, phone: '+85212345678' }),
  );

  return { view, cache };
}
