import { describe, it, jest } from '@jest/globals';

import {
  createNativeQueryInteractions,
  discoverNativeStories,
  executeNativeStory,
} from './components.stories.spec.native.helpers';
import * as queryStories from './QueryState.stories';

jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn<typeof import('expo-secure-store').getItemAsync>(
        async () => null,
      ),
      setItemAsync: jest.fn<typeof import('expo-secure-store').setItemAsync>(
        async () => undefined,
      ),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

describe('rc:QueryState canonical native plays', () => {
  it.each(discoverNativeStories(queryStories))(
    'should execute $name interactions',
    async ({ story, play }) => {
      await executeNativeStory(story, play, createNativeQueryInteractions);
    },
  );
});
