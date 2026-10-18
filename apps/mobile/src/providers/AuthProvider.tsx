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
  /** signed-in collector, whose unfinished uploads are the only ones offered on this device */
  userId: string | null;
  /** reloads the session and reports whether one exists */
  refresh: () => Promise<boolean>;
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

/** who is signed in, as the session reports them */
type Identity = Pick<AuthContextValue, 'phone' | 'userId'>;

/** the identity of a device nobody is signed in on */
const nobody: Identity = { phone: null, userId: null };

/**
 * reads the collector's phone number and identifier from the session's user
 * @param user user the session reports, if any
 * @returns the collector's identity, with what the session lacks left empty
 */
function identityOf(
  user: Record<string, unknown> | null | undefined,
): Identity {
  return {
    phone: user && 'phoneNumber' in user ? String(user.phoneNumber) : null,
    userId: typeof user?.id === 'string' ? user.id : null,
  };
}

export const AuthProvider: FC<AuthProviderProps> = ({
  children,
  client = authClient,
}) => {
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState(nobody);
  useClearCacheWhenSessionEnds(authenticated);

  const refresh = async (): Promise<boolean> => {
    const result = await client.getSession();
    const signedIn = Boolean(result.data?.session);
    setAuthenticated(signedIn);
    setIdentity(identityOf(result.data?.user));
    setLoading(false);

    return signedIn;
  };

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const forget = (): void => {
      setAuthenticated(false);
      setIdentity(nobody);
    };

    return {
      authenticated,
      loading,
      ...identity,
      refresh,
      signOut: async (): Promise<void> => {
        try {
          await client.signOut();
        } finally {
          // the device forgets the collector even when the server cannot be told
          forget();
        }
      },
      expire: forget,
      api: new ApiTransport({
        baseUrl: apiUrl,
        session: {
          getCookie: async (): Promise<string> => client.getCookie(),
          onUnauthorized: forget,
        },
      }),
    };
  }, [authenticated, client, loading, identity]);

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
