import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

import { useRouter } from 'expo-router';

import { SafeAreaProvider } from 'react-native-safe-area-context';

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

type FixtureRead = (
  ...parameters: Parameters<ApiTransport['get']>
) => ReturnType<ApiTransport['get']>;

export interface MobileResponses {
  get?: (path: string) => Promise<unknown>;
  /** isolated contextual discovery reply; defaults to no saved matches */
  relatedKnowledge?: (path: string) => Promise<unknown>;
  post?: (path: string) => Promise<unknown>;
  patch?: (path: string) => Promise<unknown>;
}

/** a phone's frame and status-bar inset, so edge-to-edge screens can lay out their controls */
export const deviceMetrics = {
  frame: { x: 0, y: 0, width: 411, height: 914 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

/** device-local state a journey starts from */
export interface MobileDevice {
  /** preference storage; defaults to a device that saved English */
  preferences?: LocalPreferencesPort;
  /** collector signed in on the device; defaults to the fixture collector */
  userId?: string | null;
}

export interface MobileHarness {
  api: ApiTransport;
  commands: jest.SpiedFunction<ApiTransport['post']>;
  patches: jest.SpiedFunction<ApiTransport['patch']>;
  reads: jest.SpiedFunction<ApiTransport['get']>;
  /** contextual reads kept separate from record and conversation request counters */
  relatedReads: jest.SpiedFunction<ApiTransport['get']>;
  router: ReturnType<typeof useRouter>;
  client: QueryClient;
}

/** collector every rendered screen is signed in as */
export const collectorId = 'collector-1';

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
 * a navigation stack that records where the journey goes
 * @returns the router the journey's screens read
 */
function navigationStack(): ReturnType<typeof useRouter> {
  return {
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
  };
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
  const { preferences = savedPreferences('en'), userId = collectorId } = device;
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: {
      getCookie: async () => '',
      onUnauthorized: () => undefined,
    },
  });
  const { reads, relatedReads } = installReadFixtures(api, responses);
  const commands = jest
    .spyOn(api, 'post')
    .mockImplementation(responses.post ?? (async () => collectionRecord));
  const patches = jest
    .spyOn(api, 'patch')
    .mockImplementation(responses.patch ?? (async () => collectionRecord));
  const router = navigationStack();
  jest.mocked(useRouter).mockReturnValue(router);
  jest.mocked(useAuth).mockReturnValue({
    api,
    authenticated: true,
    loading: false,
    phone: null,
    userId,
    refresh: async () => true,
    signOut: async () => undefined,
    expire: () => undefined,
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  await render(
    <SafeAreaProvider initialMetrics={deviceMetrics}>
      <QueryClientProvider client={client}>
        <LocaleProvider preferences={preferences}>
          <AfterLanguageLoads>{element}</AfterLanguageLoads>
        </LocaleProvider>
      </QueryClientProvider>
    </SafeAreaProvider>,
  );

  return { api, commands, patches, reads, relatedReads, router, client };
}

/**
 * Separates contextual discovery from existing record and thread fixtures.
 * @param api isolated transport used by the rendered journey
 * @param responses endpoint replies supplied by the test
 * @returns independently observable read boundaries
 */
function installReadFixtures(
  api: ApiTransport,
  responses: MobileResponses,
): Pick<MobileHarness, 'reads' | 'relatedReads'> {
  const sha256Length = 64;
  const reads = jest.fn<FixtureRead>(responses.get ?? (async () => []));
  const relatedReads = jest.fn<FixtureRead>(
    responses.relatedKnowledge ??
      (async () => ({
        cards: [],
        recordRevision: collectionRecord.recordRevision,
        contextHash: 'a'.repeat(sha256Length),
        reason: 'no_match',
      })),
  );
  jest
    .spyOn(api, 'get')
    .mockImplementation(async (path, ...parameters) =>
      path.includes('/related-knowledge?')
        ? relatedReads(path, ...parameters)
        : reads(path, ...parameters),
    );

  return { reads, relatedReads };
}
