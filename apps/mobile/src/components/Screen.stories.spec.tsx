import { describe, expect, it, jest } from '@jest/globals';

import { useEffect } from 'react';
import { Text } from 'react-native';

import {
  createNativeScreenInteractions,
  discoverNativeStories,
  executeNativeStory,
} from './components.stories.spec.native.helpers';
import * as screenStories from './Screen.stories';

import type { FC } from 'react';

import type { ScreenLoadedInteractions } from './Screen.stories';

describe('rc:Screen canonical native plays', () => {
  it.each(discoverNativeStories(screenStories))(
    'should execute $name interactions',
    async ({ story, play }) => {
      await executeNativeStory(story, play, createNativeScreenInteractions);
    },
  );
});

describe('fn:executeNativeStory', () => {
  it('should reject empty discovery before any native execution', () => {
    expect(() =>
      discoverNativeStories({ default: { title: 'Empty' } }),
    ).toThrow(Error);
  });

  it('should reject an original missing play without rendering', async () => {
    const renderStory = jest.fn(() => <Text>Invalid story</Text>);
    const [scenario] = discoverNativeStories({
      default: { title: 'Invalid' },
      Missing: { render: renderStory },
    });
    await expect(
      executeNativeStory(
        scenario.story,
        scenario.play,
        createNativeScreenInteractions,
      ),
    ).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
  });

  it('should reject a composed missing play without rendering or playing', async () => {
    const renderStory = jest.fn(() => <Text>Invalid story</Text>);
    const play = jest.fn(async () => {
      throw new Error('Must not execute');
    });
    const [scenario] = discoverNativeStories({
      default: { title: 'Invalid' },
      Missing: { render: renderStory, play },
    });
    scenario.story.play = undefined;
    await expect(
      executeNativeStory(
        scenario.story,
        scenario.play,
        createNativeScreenInteractions,
      ),
    ).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });
});

describe('fn:executeNativeStory lifecycle', () => {
  it('should execute inherited play and unmount after success', async () => {
    let mounted = false;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return <Text>Inherited native content</Text>;
    };
    const [scenario] = discoverNativeStories({
      default: {
        title: 'Inherited',
        play: async ({ loaded }: { loaded: ScreenLoadedInteractions }) => {
          expect(mounted).toBe(true);
          await loaded.interactions!.expectText('Inherited native content');
        },
      },
      Content: { render: () => <Fixture /> },
    });
    await executeNativeStory(
      scenario.story,
      scenario.play,
      createNativeScreenInteractions,
    );
    expect(mounted).toBe(false);
  });
});

describe('fn:executeNativeStory rejected lifecycle', () => {
  it('should await delayed rejection identity and unmount the native tree', async () => {
    let mounted = false;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return <Text>Awaited native content</Text>;
    };
    const failure = new Error('Delayed native rejection');
    const [scenario] = discoverNativeStories({
      default: { title: 'Rejecting' },
      Content: {
        render: () => <Fixture />,
        play: async () => {
          await Promise.resolve();
          expect(mounted).toBe(true);
          throw failure;
        },
      },
    });
    await expect(
      executeNativeStory(
        scenario.story,
        scenario.play,
        createNativeScreenInteractions,
      ),
    ).rejects.toBe(failure);
    expect(mounted).toBe(false);
  });
});
