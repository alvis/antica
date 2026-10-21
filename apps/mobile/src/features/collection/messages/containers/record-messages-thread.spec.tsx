import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen } from '@testing-library/react-native';

import RecordRoute from '../../../../app/(private)/collection/[recordId]';
import RecordMessagesRoute from '../../../../app/(private)/collection/[recordId]/messages';
import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';

import { stillWorkingAfterMs } from '../api/record-messages';

import {
  entry,
  messagesPath,
  page,
  recordId,
} from './record-messages.spec.fixtures';

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
      useFocusEffect: jest.fn<typeof import('expo-router').useFocusEffect>(),
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
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({ uri: null }),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
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

const emptyList = { items: [], nextCursor: null };

it('should invite the first message and open the area from the record screen', async () => {
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? collectionRecord : emptyList,
  });

  // the record hub's 對話 segment opens the conversation
  const opener = await screen.findByTestId('record-messages-entry');
  expect(opener).toHaveAccessibleName('Chat');
  await fireEvent.press(opener);

  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${recordId}/messages`,
  );
  await screen.unmount();

  await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? collectionRecord : emptyList,
  });

  expect(await screen.findByTestId('record-messages-empty')).toHaveTextContent(
    'Ask the assistant about this item by typing or speaking.',
  );
  expect(screen.getByTestId('record-message-send')).toBeDisabled();
});

it('should show the newest page first and load older messages on request and on scroll-up', async () => {
  const newest = [
    entry('collector', 'Is the foot ring worn?'),
    entry('assistant', 'Yes, lightly.'),
  ];
  const middle = [entry('collector', 'What is the glaze?')];
  const oldest = [entry('assistant', 'Welcome back.')];
  let releaseMiddle: () => void = () => undefined;
  const middleLoaded = new Promise<void>((resolve) => {
    releaseMiddle = resolve;
  });
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? collectionRecord
        : path === `${messagesPath}?cursor=older%201`
          ? middleLoaded.then(() => page(middle, 'older 2'))
          : path === `${messagesPath}?cursor=older%202`
            ? page(oldest)
            : page(newest, 'older 1'),
  });

  const bubble = await screen.findByTestId(
    `record-message-bubble-${newest[1]?.id}`,
  );
  expect(bubble).toHaveAccessibleName('Assistant: Yes, lightly.');
  expect(
    screen.getByTestId(`record-message-bubble-${newest[0]?.id}`),
  ).toHaveAccessibleName('You: Is the foot ring worn?');
  expect(screen.queryByText('What is the glaze?')).toBeNull();

  await fireEvent.press(screen.getByTestId('record-messages-load-earlier'));
  expect(await screen.findByLabelText('Loading…')).toBeTruthy();
  expect(screen.queryByTestId('record-messages-load-earlier')).toBeNull();
  releaseMiddle();
  expect(await screen.findByText('What is the glaze?')).toBeTruthy();

  // dragging back through the thread closes the keyboard over the composer (I17)
  expect(screen.getByTestId('record-messages-thread')).toHaveProp(
    'keyboardDismissMode',
    'on-drag',
  );
  await fireEvent(screen.getByTestId('record-messages-thread'), 'onEndReached');
  expect(await screen.findByText('Welcome back.')).toBeTruthy();
  expect(screen.queryByTestId('record-messages-load-earlier')).toBeNull();
  expect(view.reads).toHaveBeenCalledWith(
    `${messagesPath}?cursor=older%202`,
    expect.anything(),
    expect.anything(),
  );
});

it('should poll while a reply is pending and stop once it arrives', async () => {
  const question = entry('collector', 'How old is it?', { status: 'pending' });
  let reads = 0;
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) => {
      if (path === `/v1/records/${recordId}`) {
        return collectionRecord;
      }
      reads += 1;

      return reads < 2
        ? page([question])
        : page([
            { ...question, draft: { ...question.draft, status: 'ready' } },
            entry('assistant', 'Probably late Qing.'),
          ]);
    },
  });

  expect(
    await screen.findByTestId(`record-message-thinking-${question.id}`),
  ).toHaveAccessibleName('The assistant is thinking…');
  expect(
    await screen.findByText('Probably late Qing.', {}, { timeout: 5000 }),
  ).toBeTruthy();
  expect(
    screen.queryByTestId(`record-message-thinking-${question.id}`),
  ).toBeNull();
  const settled = reads;
  const pollingQuietPeriodMs = 2500;
  await act(
    async () =>
      new Promise((resolve) => setTimeout(resolve, pollingQuietPeriodMs)),
  );

  expect(reads).toBe(settled);
  expect(view.commands).not.toHaveBeenCalled();
});

it('should reassure the collector after a minute without an error', async () => {
  jest.useFakeTimers();
  try {
    const question = entry('collector', 'Any marks?', { status: 'pending' });
    await renderMobile(<RecordMessagesRoute />, {
      get: async (path) =>
        path === `/v1/records/${recordId}`
          ? collectionRecord
          : page([question]),
    });
    const status = await screen.findByTestId(
      `record-message-thinking-${question.id}`,
    );
    expect(status).toHaveAccessibleName('The assistant is thinking…');

    await act(async () => jest.advanceTimersByTime(stillWorkingAfterMs));

    expect(
      screen.getByTestId(`record-message-thinking-${question.id}`),
    ).toHaveAccessibleName(
      'Still working on this. You can leave and come back later.',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

it('should time the reassurance from when the message was stored, not when it was first seen', async () => {
  const late = entry(
    'collector',
    'Any repairs?',
    { status: 'pending' },
    new Date(Date.now() - 2 * stillWorkingAfterMs).toISOString(),
  );
  const fresh = entry('collector', 'And the base?', { status: 'pending' });
  await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? collectionRecord
        : page([late, fresh]),
  });

  expect(
    await screen.findByTestId(`record-message-thinking-${late.id}`),
  ).toHaveAccessibleName(
    'Still working on this. You can leave and come back later.',
  );
  expect(
    screen.getByTestId(`record-message-thinking-${fresh.id}`),
  ).toHaveAccessibleName('The assistant is thinking…');
});

it('should restore a failed message for an explicit send and explain source reselection', async () => {
  const failed = entry('collector', 'Describe the rim', { status: 'failed' });
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? collectionRecord : page([failed]),
  });

  await fireEvent.press(
    await screen.findByTestId(`record-message-send-again-${failed.id}`),
  );

  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
    failed.body,
  );
  expect(screen.getByTestId('record-message-reattach-hint')).toHaveTextContent(
    'Sources must be reattached before sending again.',
  );
  expect(screen.getByTestId('record-messages-related')).toBeVisible();
  expect(view.commands).not.toHaveBeenCalled();
});

it('should not restore a failed message while a composed message is being sent', async () => {
  const failed = entry('collector', 'Describe the rim', { status: 'failed' });
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? collectionRecord : page([failed]),
    post: async () => new Promise(() => undefined),
  });
  await fireEvent.changeText(
    await screen.findByTestId('record-message-input'),
    'Current draft',
  );
  await fireEvent.press(screen.getByTestId('record-message-send'));
  const restore = screen.getByTestId(`record-message-send-again-${failed.id}`);

  expect(restore).toBeDisabled();
  await fireEvent.press(restore);

  expect(screen.getByTestId('record-message-input')).toHaveDisplayValue(
    'Current draft',
  );
  expect(view.commands).toHaveBeenCalledTimes(1);
});

it('should retry a failed thread read', async () => {
  let reads = 0;
  await renderMobile(<RecordMessagesRoute />, {
    get: async (path) => {
      if (path === `/v1/records/${recordId}`) {
        return collectionRecord;
      }
      reads += 1;
      if (reads === 1) {
        throw new Error('offline');
      }

      return page([entry('assistant', 'Back online.')]);
    },
  });

  await fireEvent.press(await screen.findByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Back online.')).toBeTruthy();
});
