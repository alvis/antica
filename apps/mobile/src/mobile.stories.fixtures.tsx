import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { recordDetailSchema } from '@antica/contracts';

import { savedPreferences } from './i18n/preferences.spec.fixtures';
import { AuthProvider } from './providers/AuthProvider';
import { LocaleProvider } from './providers/LocaleProvider';

import type { PropsWithChildren, ReactElement } from 'react';

import type { InterfaceLanguagePreference } from './i18n/preferences';

export const storyRecordId = '00000000-0000-4000-8000-000000000001';
export const storyRunId = '00000000-0000-4000-8000-000000000010';

export const storyRecord = recordDetailSchema.parse({
  id: storyRecordId,
  code: 'A-001',
  name: 'Blue-and-white bowl',
  unitKind: 'single',
  components: [],
  pieceCount: 1,
  categoryIds: [],
  materialIds: [],
  period: { label: 'Late Qing dynasty', status: 'collectorClaim' },
  dimensions: { height: { value: 8.4, unit: 'cm' } },
  location: { locationId: null, detail: 'Study cabinet, shelf 2' },
  acquisition: { receiptAssetIds: [] },
  tags: ['ceramic', 'blue-and-white'],
  description: 'Porcelain bowl with a hand-painted floral border.',
  collectorJudgment: 'The foot shows light wear consistent with age.',
  condition: null,
  recordRevision: 3,
  analysisInputVersion: 2,
  evidenceVersion: 2,
  createdAt: '2026-10-13T00:00:00.000Z',
  updatedAt: '2026-10-13T06:30:00.000Z',
  mediaIds: [],
  checkIds: [],
  latestRunId: storyRunId,
  analysisFreshness: 'current',
});

export type StoryResponseFactory = (
  request: Request,
) => object | Promise<object>;

export type StoryResponse = object | StoryResponseFactory;

export type StoryResponses = Readonly<Partial<Record<string, StoryResponse>>>;

export type MobileStoryShellProps = PropsWithChildren<{
  responses: StoryResponses;
  locale?: InterfaceLanguagePreference;
  delayMs?: number;
}>;

const initialFetch = globalThis.fetch;
const successStatus = 200;
const missingFixtureStatus = 501;
const storySurfaceStyle = { width: '100%', maxWidth: 720 } as const;
const storySafeAreaMetrics = {
  frame: { x: 0, y: 0, width: 720, height: 1280 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
} as const;
const storyAuthClient = {
  getSession: async () => ({
    data: {
      session: { id: 'storybook-session' },
      user: { phoneNumber: null },
    },
  }),
  signOut: async () => undefined,
  getCookie: async () => '',
};

/**
 * creates a JSON response for the story transport
 * @param body JSON-compatible fixture body.
 * @param status HTTP response status.
 * @returns response consumed by the production API transport
 */
function jsonResponse(body: unknown, status = successStatus): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * returns a stable method and path key for a fixture request
 * @param request browser request received by the fixture.
 * @returns stable method and pathname key
 */
function requestPath(request: Request): string {
  const url = new URL(request.url, 'https://storybook.invalid');

  return `${request.method.toUpperCase()} ${url.pathname}`;
}

/**
 * supplies an authenticated mobile runtime backed by deterministic HTTP fixtures
 * @param props story content, locale, and API responses.
 * @param props.children component rendered inside the providers.
 * @param props.responses HTTP response map for the story.
 * @param props.locale initial interface locale.
 * @param props.delayMs optional network delay.
 * @returns isolated providers plus a visible request trace
 */
export function MobileStoryShell({
  children,
  responses,
  locale = 'en',
  delayMs = 0,
}: Readonly<MobileStoryShellProps>): ReactElement {
  const [requests, setRequests] = useState<string[]>([]);
  const client = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
        },
      }),
    [],
  );
  const fixtureFetch = useMemo(
    () =>
      createFixtureFetch(responses, delayMs, (key) =>
        setRequests((current) => [...current, key]),
      ),
    [delayMs, responses],
  );

  // a story device that already saved its interface language
  const [preferences] = useState(() => savedPreferences(locale));
  globalThis.fetch = fixtureFetch;

  useEffect(
    () => () => {
      if (globalThis.fetch === fixtureFetch) {
        globalThis.fetch = initialFetch;
      }
      client.clear();
    },
    [client, fixtureFetch],
  );

  return (
    <SafeAreaProvider initialMetrics={storySafeAreaMetrics}>
      <View style={storySurfaceStyle}>
        <QueryClientProvider client={client}>
          <LocaleProvider preferences={preferences}>
            <AuthProvider client={storyAuthClient}>{children}</AuthProvider>
          </LocaleProvider>
        </QueryClientProvider>
        <Text accessibilityLabel="Story network activity">
          Network activity: {requests.join(' · ') || 'waiting'}
        </Text>
      </View>
    </SafeAreaProvider>
  );
}

/**
 * creates the API-backed fetch fixture used by a story
 * @param responses response map for API methods and paths.
 * @param delayMs optional response delay used by loading stories.
 * @param recordRequest observer for the visible request trace.
 * @returns fetch-compatible deterministic story transport
 */
function createFixtureFetch(
  responses: StoryResponses,
  delayMs: number,
  recordRequest: (key: string) => void,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const key = requestPath(request);
    const path = new URL(request.url).pathname;
    if (path.includes('/api/auth/')) {
      return jsonResponse({ session: null, user: null });
    }
    recordRequest(key);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const configured = responses[key];
    if (configured === undefined) {
      return jsonResponse(
        {
          error: {
            code: 'STORY_FIXTURE_MISSING',
            message: `No Storybook fixture is registered for ${key}.`,
          },
        },
        missingFixtureStatus,
      );
    }
    const result =
      typeof configured === 'function' ? await configured(request) : configured;
    if ('storyError' in result) {
      const error = result as {
        storyError: { status: number; code: string; message: string };
      };

      return jsonResponse(
        {
          error: {
            code: error.storyError.code,
            message: error.storyError.message,
          },
        },
        error.storyError.status,
      );
    }

    return jsonResponse(result);
  };
}
