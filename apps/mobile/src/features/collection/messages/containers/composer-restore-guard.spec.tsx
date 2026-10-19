import { expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { ApiTransport } from '@antica/client';

import { collectionRecord } from '../../../../mobile.spec.fixtures';
import { relatedAttachment } from '../../../knowledge/containers/related-knowledge.spec.fixtures';

import { useMessageComposer } from '../hooks/useMessageComposer';

import type { PropsWithChildren } from 'react';

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({
    uri: 'file:///voice-message.m4a',
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  }),
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('../../../../adapters/media-upload', () => ({
  uploadMedia: async () => new Promise(() => undefined),
}));

it('should preserve in-flight words and evidence when a consumer requests restoration during a send', async () => {
  const api = new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  });
  jest
    .spyOn(api, 'post')
    .mockImplementation(async () => new Promise(() => undefined));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const { result } = await renderHook(
    () =>
      useMessageComposer({
        api,
        recordId: collectionRecord.id,
        record: collectionRecord,
        t: (key) => key,
      }),
    {
      wrapper: ({ children }: PropsWithChildren) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  await act(() => {
    result.current.setText('Current message');
    result.current.attach(relatedAttachment, 'Chosen source');
  });
  await act(() => {
    void result.current.send?.();
  });
  expect(result.current.busy).toBe(true);
  expect(result.current.canRestore).toBe(false);

  await act(() => result.current.restore('Old failed message'));

  expect(result.current.text).toBe('Current message');
  expect(result.current.attachments).toEqual([
    { reference: relatedAttachment, title: 'Chosen source' },
  ]);
  expect(result.current.hint).toBe('');
});

// A voice reset does not cancel recording or an upload already in progress.
// Restoration must preserve the collector's current draft until voice settles.
it.each(['recording', 'transcribing'] as const)(
  'should preserve draft words and selected evidence while voice is %s',
  async (phase) => {
    const api = new ApiTransport({
      baseUrl: 'https://api.example',
      session: { getCookie: async () => '', onUnauthorized: () => undefined },
    });
    const post = jest.spyOn(api, 'post');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const { result } = await renderHook(
      () =>
        useMessageComposer({
          api,
          recordId: collectionRecord.id,
          record: collectionRecord,
          t: (key) => key,
        }),
      {
        wrapper: ({ children }: PropsWithChildren) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      },
    );
    await act(() => {
      result.current.setText('Current voice draft');
      result.current.attach(relatedAttachment, 'Chosen source');
    });
    expect(result.current.canRestore).toBe(true);
    await act(async () => result.current.voice.start());
    if (phase === 'transcribing') {
      await act(() => {
        void result.current.voice.stop();
      });
    }
    expect(result.current.voice.phase).toBe(phase);
    expect(result.current.canRestore).toBe(false);

    await act(() => result.current.restore('Old failed message'));

    expect(result.current.text).toBe('Current voice draft');
    expect(result.current.attachments).toEqual([
      { reference: relatedAttachment, title: 'Chosen source' },
    ]);
    expect(result.current.hint).toBe('');
    expect(result.current.voice.phase).toBe(phase);
    expect(post).not.toHaveBeenCalled();
  },
);
