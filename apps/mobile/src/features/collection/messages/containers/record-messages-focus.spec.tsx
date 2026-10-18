import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { FlatList } from 'react-native';

import RecordMessagesRoute from '../../../../app/(private)/collection/[recordId]/messages';
import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';

import { entry, page, recordId } from './record-messages.spec.fixtures';

jest.mock('../../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({ uri: null }),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
}));

const question = entry('collector', 'What is the mark?');
const answer = entry('assistant', 'It reads Kangxi.');
const followUp = entry('collector', 'Rename it then');

/**
 * opens the message area as the change history does
 * @param messageId message named by the deep link, if any
 * @returns the test harness
 */
async function openThread(messageId?: string): ReturnType<typeof renderMobile> {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue(messageId ? { recordId, messageId } : { recordId });

  return renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? collectionRecord
        : page([question, answer, followUp], 'older'),
  });
}

it('should scroll to and mark the message opened from the change history once', async () => {
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  await openThread(question.id);

  expect(await screen.findByText('Opened from change history')).toBeTruthy();
  await waitFor(() =>
    expect(scrollToIndex).toHaveBeenCalledWith({
      index: 2,
      animated: false,
      viewPosition: 0.5,
    }),
  );
  expect(scrollToIndex).toHaveBeenCalledTimes(1);
  expect(screen.getAllByText('Opened from change history')).toHaveLength(1);
});

it('should stay on the newest messages when the opened message is on an older page', async () => {
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  await openThread('00000000-0000-4000-8000-000000000999');

  await screen.findByText('What is the mark?');

  expect(scrollToIndex).not.toHaveBeenCalled();
  expect(screen.queryByText('Opened from change history')).toBeNull();
});

it('should not scroll when no message is named', async () => {
  const scrollToIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
  await openThread();

  await screen.findByText('What is the mark?');

  expect(scrollToIndex).not.toHaveBeenCalled();
});

it('should move near a message the list has not measured yet', async () => {
  const scrollToOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
  await openThread(question.id);
  await screen.findByText('Opened from change history');

  await fireEvent(
    screen.getByTestId('record-messages-thread'),
    'scrollToIndexFailed',
    { index: 2, averageItemLength: 80, highestMeasuredFrameIndex: 0 },
  );

  expect(scrollToOffset).toHaveBeenCalledWith({ offset: 160, animated: false });
});
