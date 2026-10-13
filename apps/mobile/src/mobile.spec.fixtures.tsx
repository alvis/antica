import { jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';

import { useRouter } from 'expo-router';

import { ApiTransport } from '@antica/client';
import { recordDetailSchema } from '@antica/contracts';

import { useAuth } from './auth';
import { LocaleProvider } from './locale';

import type { ReactNode } from 'react';

export interface MobileResponses {
  get?: (path: string) => Promise<unknown>;
  post?: (path: string) => Promise<unknown>;
  patch?: (path: string) => Promise<unknown>;
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
 * Renders a native journey with isolated API, navigation, and query state.
 * @param element Native route or feature to render.
 * @param responses API replies for this journey.
 * @returns Isolated query state and observable network/navigation boundaries.
 */
export async function renderMobile(
  element: ReactNode,
  responses: MobileResponses,
): Promise<MobileHarness> {
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
    refresh: async () => undefined,
    signOut: async () => undefined,
    expire: () => undefined,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  await render(
    <QueryClientProvider client={client}>
      <LocaleProvider>{element}</LocaleProvider>
    </QueryClientProvider>,
  );

  return { api, commands, patches, reads, router, client };
}
