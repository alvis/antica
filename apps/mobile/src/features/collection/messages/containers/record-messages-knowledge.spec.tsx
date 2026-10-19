import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';
import {
  relatedAttachment,
  relatedCard,
  relatedPage,
  relatedPath,
} from '../../../knowledge/containers/related-knowledge.spec.fixtures';

import {
  messagesPath,
  page,
  recordId,
  sentTo,
} from './record-messages.spec.fixtures';
import { RecordMessagesContainer } from './RecordMessagesContainer';

jest.mock(
  '../../../../providers/AuthProvider',
  () =>
    ({
      useAuth:
        jest.fn<typeof import('../../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: jest.fn<
        typeof import('expo-router').useLocalSearchParams
      >(() => ({ recordId: '00000000-0000-4000-8000-000000000001' })),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-crypto',
  () =>
    ({
      randomUUID:
        jest.requireActual<typeof import('node:crypto')>('node:crypto')
          .randomUUID,
    }) satisfies Partial<typeof import('expo-crypto')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => {
  const recorder = {
    uri: 'file:///voice-message.m4a' as string | null,
    prepareToRecordAsync: async () => undefined,
    record: () => undefined,
    stop: async () => undefined,
  };

  return {
    useAudioRecorder: () => recorder,
    requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true })),
    setAudioModeAsync: jest.fn(async () => undefined),
    RecordingPresets: { HIGH_QUALITY: {} },
    recorder,
  };
});
jest.mock(
  '../../../../adapters/media-upload',
  () =>
    ({
      uploadMedia:
        jest.fn<
          typeof import('../../../../adapters/media-upload').uploadMedia
        >(),
    }) satisfies Partial<typeof import('../../../../adapters/media-upload')>,
);

it('should attach visibly, remove, and send only the explicitly chosen claim', async () => {
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path.startsWith(relatedPath)
          ? relatedPage
          : path === `/v1/records/${recordId}`
            ? collectionRecord
            : page([]),
      post: async () => ({}),
    },
  );
  await fireEvent.press(
    await screen.findByTestId(`record-related-attach-${relatedCard.entryId}`),
  );
  expect(
    screen.getByTestId('record-message-evidence-attachment-surface'),
  ).toHaveTextContent(new RegExp(relatedCard.title));
  expect(view.commands).not.toHaveBeenCalled();

  await fireEvent.press(
    screen.getByTestId('record-message-evidence-remove-surface'),
  );
  expect(
    screen.queryByTestId('record-message-evidence-attachment-surface'),
  ).toBeNull();
  await fireEvent.press(
    screen.getByTestId(`record-related-attach-${relatedCard.entryId}`),
  );
  await fireEvent.changeText(
    screen.getByTestId('record-message-input'),
    'Explain the surface',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));

  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(1),
  );
  expect(
    sentTo(view.commands, messagesPath)[0]?.body.knowledgeAttachments,
  ).toEqual([relatedAttachment]);
  await waitFor(() =>
    expect(
      screen.queryByTestId('record-message-evidence-attachment-surface'),
    ).toBeNull(),
  );
  expect(view.patches).not.toHaveBeenCalled();
});

it('should preserve an identical retry key and renew it when attachments change', async () => {
  const expectedAttempts = 3;
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path.startsWith(relatedPath)
          ? relatedPage
          : path === `/v1/records/${recordId}`
            ? collectionRecord
            : page([]),
      post: async () => {
        throw new TypeError('Network request failed');
      },
    },
  );
  await fireEvent.press(
    await screen.findByTestId(`record-related-attach-${relatedCard.entryId}`),
  );
  await fireEvent.changeText(
    screen.getByTestId('record-message-input'),
    'Explain the surface',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await screen.findByTestId('record-message-error');
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(2),
  );
  await waitFor(() =>
    expect(screen.getByTestId('record-message-send')).not.toBeDisabled(),
  );
  await fireEvent.press(
    screen.getByTestId('record-message-evidence-remove-surface'),
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(expectedAttempts),
  );

  const posts = sentTo(view.commands, messagesPath);
  expect(posts[1]?.idempotencyKey).toBe(posts[0]?.idempotencyKey);
  expect(posts[2]?.idempotencyKey).not.toBe(posts[0]?.idempotencyKey);
  expect(posts[1]?.body.knowledgeAttachments).toEqual([relatedAttachment]);
  expect(posts[2]?.body.knowledgeAttachments ?? []).toEqual([]);
});

it('should keep one visible chip when the selected candidate is pressed twice', async () => {
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path.startsWith(relatedPath)
          ? relatedPage
          : path === `/v1/records/${recordId}`
            ? collectionRecord
            : page([]),
      post: async () => ({}),
    },
  );
  await fireEvent.press(
    await screen.findByTestId(`record-related-claim-${relatedCard.entryId}`),
  );
  const candidate = screen.getByTestId(
    `record-related-attach-${relatedCard.entryId}`,
  );
  expect(candidate).toBeDisabled();
  await fireEvent.press(candidate);
  expect(
    screen.getAllByTestId('record-message-evidence-attachment-surface'),
  ).toHaveLength(1);
  await fireEvent.changeText(
    screen.getByTestId('record-message-input'),
    'Explain',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));

  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(1),
  );
  expect(
    sentTo(view.commands, messagesPath)[0]?.body.knowledgeAttachments,
  ).toEqual([relatedAttachment]);
});

it.each([
  { name: 'six claims', limit: 6, distinctEntries: false },
  { name: 'three entries', limit: 3, distinctEntries: true },
])(
  'should retain exactly $name when refreshed candidates offer more evidence',
  async ({ limit, distinctEntries }) => {
    const view = await renderMobile(
      <RecordMessagesContainer recordId={recordId} />,
      {
        relatedKnowledge: async () => relatedPage,
        get: async (path) =>
          path.startsWith(relatedPath)
            ? relatedPage
            : path === `/v1/records/${recordId}`
              ? collectionRecord
              : page([]),
        post: async () => ({}),
      },
    );
    await screen.findByTestId(`record-related-attach-${relatedCard.entryId}`);
    for (let index = 0; index <= limit; index += 1) {
      const entryId = distinctEntries
        ? `00000000-0000-4000-8000-00000000020${index}`
        : relatedCard.entryId;
      view.relatedReads.mockResolvedValueOnce({
        ...relatedPage,
        cards: [
          {
            ...relatedCard,
            title: `Candidate ${index}`,
            entryId,
            excerpt: { ...relatedCard.excerpt, claimKey: `claim-${index}` },
          },
        ],
      });
      await act(async () => {
        await view.client.invalidateQueries({
          queryKey: ['record-related-knowledge'],
        });
      });
      await screen.findByText(`Candidate ${index}`);
      const candidate = await screen.findByTestId(
        `record-related-attach-${entryId}`,
      );
      if (index === limit) {
        expect(candidate).toBeDisabled();
      } else {
        await fireEvent.press(candidate);
      }
    }
    await fireEvent.changeText(
      screen.getByTestId('record-message-input'),
      'Explain selected evidence',
    );
    await fireEvent.press(screen.getByTestId('record-message-send'));

    await waitFor(() =>
      expect(sentTo(view.commands, messagesPath)).toHaveLength(1),
    );
    expect(
      sentTo(view.commands, messagesPath)[0]?.body.knowledgeAttachments,
    ).toHaveLength(limit);
  },
);
