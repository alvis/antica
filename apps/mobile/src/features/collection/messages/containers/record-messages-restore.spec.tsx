import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  collectionRecord,
  renderMobile,
  savedLanguage,
} from '../../../../mobile.spec.fixtures';
import {
  relatedCard,
  relatedPage,
} from '../../../knowledge/containers/related-knowledge.spec.fixtures';

import { historicalAnswer } from './record-messages-knowledge.spec.fixtures';
import {
  entry,
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

/** opens the 相關知識 tray, which the composer keeps collapsed until asked */
async function openRelatedTray(): Promise<void> {
  await fireEvent.press(
    await screen.findByTestId('record-messages-related-toggle'),
  );
}

it('should discard frozen suggestions and current selections when restoring a failed message', async () => {
  const failed = {
    ...entry('collector', 'Explain the surface', { status: 'failed' }),
    knowledgeEvidence: historicalAnswer.knowledgeEvidence,
  };
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      relatedKnowledge: async () => relatedPage,
      get: async (path) =>
        path === `/v1/records/${recordId}` ? collectionRecord : page([failed]),
      post: async () => ({}),
    },
  );
  await openRelatedTray();
  await fireEvent.press(
    await screen.findByTestId(`record-related-attach-${relatedCard.entryId}`),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-send-again-${failed.id}`),
  );

  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
    failed.body,
  );
  expect(
    screen.queryByTestId('record-message-evidence-attachment-surface'),
  ).toBeNull();
  expect(screen.getByTestId('record-message-reattach-hint')).toHaveTextContent(
    'Sources must be reattached before sending again.',
  );
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(1),
  );
  expect(
    sentTo(view.commands, messagesPath)[0]?.body.knowledgeAttachments,
  ).toBeUndefined();
});

it('should forget an unfinished network retry when the same text is restored', async () => {
  const failed = entry('collector', 'Explain the surface', {
    status: 'failed',
  });
  const view = await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      get: async (path) =>
        path === `/v1/records/${recordId}` ? collectionRecord : page([failed]),
      post: async () => ({}),
    },
  );
  view.commands.mockRejectedValueOnce(new TypeError('Network request failed'));
  await fireEvent.changeText(
    await screen.findByTestId('record-message-input'),
    failed.body,
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await screen.findByTestId('record-message-error');
  await fireEvent.press(
    screen.getByTestId(`record-message-send-again-${failed.id}`),
  );
  expect(sentTo(view.commands, messagesPath)).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('record-message-send'));
  await waitFor(() =>
    expect(sentTo(view.commands, messagesPath)).toHaveLength(2),
  );

  const posts = sentTo(view.commands, messagesPath);
  expect(posts[1]?.idempotencyKey).not.toBe(posts[0]?.idempotencyKey);
});

it('should explain source reselection in Traditional Chinese', async () => {
  const failed = entry('collector', '說明表面', { status: 'failed' });
  await renderMobile(
    <RecordMessagesContainer recordId={recordId} />,
    {
      get: async (path) =>
        path === `/v1/records/${recordId}` ? collectionRecord : page([failed]),
    },
    savedLanguage('zh-Hant'),
  );

  await fireEvent.press(
    await screen.findByTestId(`record-message-send-again-${failed.id}`),
  );

  expect(screen.getByTestId('record-message-reattach-hint')).toHaveTextContent(
    '再次傳送前，請重新附加來源。',
  );
  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
    failed.body,
  );
});
