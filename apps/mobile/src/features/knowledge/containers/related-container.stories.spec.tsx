import { expect, it, jest } from '@jest/globals';
import { composeStories } from '@storybook/react-native-web-vite';
import { render, waitFor } from '@testing-library/react-native';

import { createElement } from 'react';

import * as containerStories from './RelatedKnowledgeContainer.stories';

import type { ReactNode } from 'react';

jest.mock('../../../providers/AuthProvider', () => {
  const { ApiTransport } =
    jest.requireActual<typeof import('@antica/client')>('@antica/client');
  const { useQueryClient } = jest.requireActual<
    typeof import('@tanstack/react-query')
  >('@tanstack/react-query');
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  const api = new ApiTransport({
    baseUrl: 'https://storybook.invalid',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });

  return {
    AuthProvider: ({ children }: { children: ReactNode }): ReactNode => {
      const client = useQueryClient();
      useEffect(() => () => client.clear(), [client]);

      return children;
    },
    useAuth: () => ({
      api,
      userId: 'storybook-user',
      authenticated: true,
      loading: false,
      phone: null,
      refresh: async () => true,
      signOut: async () => undefined,
      expire: () => undefined,
    }),
  };
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const stories = composeStories(containerStories);
it('should render local loading, empty, failed and saved container stories', async () => {
  jest.useFakeTimers();
  try {
    for (const [story, id] of [
      [
        stories.Saved,
        'record-related-open-00000000-0000-4000-8000-000000000068',
      ],
      [stories.Loading, 'record-related-loading'],
      [stories.NoMatch, 'record-related-empty'],
      [stories.Failure, 'record-related-error'],
    ] as const) {
      const view = await render(createElement(story));
      try {
        await waitFor(() => expect(view.getByTestId(id)).toBeTruthy());
      } finally {
        await view.unmount();
      }
    }
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
  }
});
