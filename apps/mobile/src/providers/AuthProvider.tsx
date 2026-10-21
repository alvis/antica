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

import { expoClient } from '@better-auth/expo/client';
import { phoneNumberClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

import { readApiOrigin } from '../adapters/api-origin';
import { createCookieStorage } from '../adapters/cookie-storage';
import { MobileApiTransport } from '../adapters/mobile-api-transport';

import type { FC, PropsWithChildren } from 'react';

import type { ApiTransport } from '@antica/client';

export const apiUrl = readApiOrigin(process.env.EXPO_PUBLIC_API_URL, __DEV__);
const cookieStorage = createCookieStorage(SecureStore, 'antica_cookie');
export const authClient = createAuthClient({
  baseURL: apiUrl,
  plugins: [
    expoClient({
      scheme: 'antica',
      storagePrefix: 'antica',
      storage: cookieStorage,
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
 * @param userId current owner, so switching accounts also discards private queries
 */
function useClearCacheWhenSessionEnds(
  authenticated: boolean,
  userId: string | null,
): void {
  const queryClient = useQueryClient();
  const previous = useRef({ authenticated: false, userId });

  useEffect(() => {
    if (
      previous.current.authenticated &&
      (!authenticated || previous.current.userId !== userId)
    ) {
      queryClient.clear();
    }
    previous.current = { authenticated, userId };
  }, [authenticated, userId, queryClient]);
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
  const signedIn = useRef(false);
  const sessionVersion = useRef(0);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState(nobody);
  useClearCacheWhenSessionEnds(authenticated, identity.userId);

  const refresh = async (): Promise<boolean> => {
    const version = ++sessionVersion.current;
    cookieStorage.clear();
    const result = await client.getSession();
    if (sessionVersion.current !== version) {
      setLoading(false);
      return false;
    }
    const restored = Boolean(result.data?.session);
    signedIn.current = restored;
    setAuthenticated(restored);
    setIdentity(identityOf(result.data?.user));
    setLoading(false);

    return restored;
  };

  useEffect(() => {
    void refresh().catch(() => setLoading(false));
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const forget = (): void => {
      sessionVersion.current += 1;
      signedIn.current = false;
      cookieStorage.clear();
      setAuthenticated(false);
      setIdentity(nobody);
      setLoading(false);
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
          await cookieStorage.remove();
        }
      },
      expire: forget,
      api: new MobileApiTransport({
        refreshCookie: cookieStorage.clear,
        getSessionVersion: () => sessionVersion.current,
        baseUrl: apiUrl,
        session: {
          getCookie: async (): Promise<string> => {
            if (!signedIn.current) {
              return '';
            }
            const version = sessionVersion.current;
            const cookie = await client.getCookie();

            return sessionVersion.current === version ? cookie : '';
          },
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
