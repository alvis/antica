import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

import { useRouter } from 'expo-router';

import { ApiTransport } from '@antica/client';
import { recordDetailSchema } from '@antica/contracts';

import { savedPreferences } from './i18n/preferences.spec.fixtures';
import { useAuth } from './providers/AuthProvider';
import {
  LocaleProvider,
  useInterfaceLanguage,
} from './providers/LocaleProvider';

import type { PropsWithChildren, ReactElement, ReactNode } from 'react';

import type {
  InterfaceLanguagePreference,
  LocalPreferencesPort,
} from './i18n/preferences';

export interface MobileResponses {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string) => Promise<unknown>;
  patch?: (path: string) => Promise<unknown>;
}

/** device-local state a journey starts from */
export interface MobileDevice {
  /** preference storage; defaults to a device that saved English */
  preferences?: LocalPreferencesPort;
}

export interface MobileHarness {
  api: ApiTransport;
  commands: jest.SpiedFunction<ApiTransport['post']>;
  patches: jest.SpiedFunction<ApiTransport['patch']>;
  reads: jest.SpiedFunction<ApiTransport['get']>;
  router: ReturnType<typeof useRouter>;
  client: QueryClient;
}

export const collectionRecord = recordDetailSchema.parse({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'A-001',
  name: null,
  unitKind: 'single',
  components: [],
  pieceCount: 1,
  categoryIds: [],
  materialIds: [],
  period: null,
  dimensions: {},
  location: { locationId: null, detail: '' },
  acquisition: { receiptAssetIds: [] },
  tags: [],
  description: '',
  collectorJudgment: null,
  recordRevision: 1,
  analysisInputVersion: 1,
  evidenceVersion: 1,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T00:00:00.000Z',
  mediaIds: [],
  checkIds: [],
  latestRunId: null,
  analysisFreshness: 'unanalyzed',
});

/**
 * describes a device that already saved an interface-language choice
 * @param interfaceLanguage saved choice
 * @returns device state for renderMobile
 */
export function savedLanguage(
  interfaceLanguage: InterfaceLanguagePreference,
): MobileDevice {
  return { preferences: savedPreferences(interfaceLanguage) };
}

/**
 * starts a journey once the saved language is read, as a collector meets the app after startup;
 * the provider's own specs cover the screens it keeps mounted while reading
 * @param props journey content
 * @param props.children journey content
 * @returns the content once the saved language is known
 */
function AfterLanguageLoads({
  children,
}: Readonly<PropsWithChildren>): ReactElement {
  const { status } = useInterfaceLanguage();

  return <>{status === 'loading' ? null : children}</>;
}

/**
 * renders a native journey with isolated API, navigation, and query state
 * @param element native route or feature to render.
 * @param responses API replies for this journey.
 * @param device device-local state; defaults to a device that saved English
 * @returns isolated query state and observable network/navigation boundaries
 */
export async function renderMobile(
  element: ReactNode,
  responses: MobileResponses,
  device: MobileDevice = {},
): Promise<MobileHarness> {
  const { preferences = savedPreferences('en') } = device;
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: {
      getCookie: async () => '',
      onUnauthorized: () => undefined,
    },
  });
  const reads = jest
    .spyOn(api, 'get')
    .mockImplementation(responses.get ?? (async () => []));
  const commands = jest
    .spyOn(api, 'post')
    .mockImplementation(responses.post ?? (async () => collectionRecord));
  const patches = jest
    .spyOn(api, 'patch')
    .mockImplementation(responses.patch ?? (async () => collectionRecord));
  const router = {
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: () => false,
    push: jest.fn(),
    navigate: jest.fn(),
    dismiss: jest.fn(),
    dismissTo: jest.fn(),
    dismissAll: jest.fn(),
    canDismiss: () => false,
    setParams: jest.fn(),
    reload: jest.fn(),
    prefetch: jest.fn(),
  } satisfies ReturnType<typeof useRouter>;
  jest.mocked(useRouter).mockReturnValue(router);
  jest.mocked(useAuth).mockReturnValue({
    api,
    authenticated: true,
    loading: false,
    phone: null,
    refresh: async () => true,
    signOut: async () => undefined,
    expire: () => undefined,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <LocaleProvider preferences={preferences}>
        <AfterLanguageLoads>{element}</AfterLanguageLoads>
      </LocaleProvider>
    </QueryClientProvider>,
  );

  return { api, commands, patches, reads, router, client };
}
