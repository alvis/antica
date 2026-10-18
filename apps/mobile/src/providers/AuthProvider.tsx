import { useQueryClient } from '@tanstack/react-query';

import * as SecureStore from 'expo-secure-store';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ApiTransport } from '@antica/client';

import { expoClient } from '@better-auth/expo/client';
import { phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { readApiOrigin } from '../adapters/api-origin';

import type { FC, PropsWithChildren } from 'react';

export const apiUrl = readApiOrigin(process.env.EXPO_PUBLIC_API_URL, __DEV__);
export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    expoClient({
      scheme: 'antica',
      storagePrefix: 'antica',
      storage: SecureStore,
    }),
    phoneNumberClient(),
  ],
});

interface AuthContextValue {
  authenticated: boolean;
  loading: boolean;
  phone: string | null;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  expire: () => void;
  api: ApiTransport;
}

interface AuthRuntimeClient {
  getSession(): Promise<{
    data: {
      session: unknown;
      user: Record<string, unknown> | null;
    } | null;
  }>;
  signOut(): Promise<unknown>;
  getCookie(): string | Promise<string>;
}

type AuthProviderProps = PropsWithChildren<{
  client?: AuthRuntimeClient;
}>;

const authContext = createContext<AuthContextValue | null>(null);

/**
 * clears cached private data whenever a signed-in collector becomes signed out, however the
 * session ends: sign-out, expiry, a rejected cookie or a restore that no longer finds it
 * @param authenticated whether a collector is signed in now
 */
function useClearCacheWhenSessionEnds(authenticated: boolean): void {
  const queryClient = useQueryClient();
  const wasAuthenticated = useRef(false);

  useEffect(() => {
    if (wasAuthenticated.current && !authenticated) {
      queryClient.clear();
    }
    wasAuthenticated.current = authenticated;
  }, [authenticated, queryClient]);
}

export const AuthProvider: FC<AuthProviderProps> = ({
  children,
  client = authClient,
}) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState<string | null>(null);
  useClearCacheWhenSessionEnds(authenticated);

  const refresh = async (): Promise<void> => {
    const result = await client.getSession();
    setAuthenticated(Boolean(result.data?.session));
    setPhone(
      result.data?.user && 'phoneNumber' in result.data.user
        ? String(result.data.user.phoneNumber)
        : null,
    );
    setLoading(false);
  };

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      authenticated,
      loading,
      phone,
      refresh,
      signOut: async (): Promise<void> => {
        try {
          await client.signOut();
        } finally {
          // the device forgets the collector even when the server cannot be told
          setAuthenticated(false);
          setPhone(null);
        }
      },
      expire: (): void => {
        setAuthenticated(false);
        setPhone(null);
      },
      api: new ApiTransport({
        baseUrl: apiUrl,
        session: {
          getCookie: async (): Promise<string> => client.getCookie(),
          onUnauthorized: (): void => {
            setAuthenticated(false);
            setPhone(null);
          },
        },
      }),
    }),
    [authenticated, client, loading, phone],
  );

  return <authContext.Provider value={value}>{children}</authContext.Provider>;
};

/**
 * returns the authenticated mobile runtime
 * @returns current authentication state and API transport
 * @throws {Error} when AuthProvider is missing
 */
export function useAuth(): AuthContextValue {
  const value = useContext(authContext);
  if (value === null) {
    throw new Error('AuthProvider is missing.');
  }

  return value;
}
