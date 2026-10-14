import { composeStory } from '@storybook/react-native-web-vite';

import { createElement, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  createDomInteractions,
  discoverStories,
  executeDomStory,
} from './ui.stories.spec.dom.helpers.js';

import type { FC } from 'react';

import type { StoryCase, StoryModule } from './ui.stories.spec.dom.helpers.js';

const storyModules = import.meta.glob<StoryModule>('./**/*.stories.tsx', {
  eager: true,
});
const stories = discoverStories(storyModules);

describe('rc:SharedControls DOM fallback', () => {
  it.each(stories)('should execute $name interactions', async (scenario) => {
    await executeDomStory(scenario);
  });
});

describe('DOM story gate failures', () => {
  it('should reject empty discovery even when other tests exist', () => {
    expect(() => discoverStories({})).toThrow(Error);
  });

  it('should reject a story without an original play', async () => {
    const renderStory = vi.fn(() => createElement('p', null, 'Missing'));
    const [scenario] = discoverStories({
      fixture: {
        default: { title: 'Harness' },
        Missing: { render: renderStory },
      },
    });
    await expect(executeDomStory(scenario)).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
  });

  it('should reject a composed story whose play is unavailable', async () => {
    const renderStory = vi.fn(() => createElement('p', null, 'Missing'));
    const play = vi.fn(async (): Promise<void> => {
      throw new Error('Must not execute');
    });
    const story = composeStory(
      { render: renderStory, play },
      { title: 'Harness' },
    );
    story.play = undefined;
    await expect(
      executeDomStory({
        name: 'Missing composed play',
        module: { default: { title: 'Harness' } },
        story,
        play,
      }),
    ).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('should execute an inherited play and release the successful canvas', async () => {
    let canvas: HTMLElement | undefined;
    const [scenario] = discoverStories({
      fixture: {
        default: {
          title: 'Harness',
          play: async ({ canvasElement }) => {
            canvas = canvasElement;
            expect(canvasElement.textContent).toBe('Inherited play');
            expect(canvasElement.isConnected).toBe(true);
          },
        },
        Inherited: { render: () => createElement('p', null, 'Inherited play') },
      },
    });
    await executeDomStory(scenario);
    expect(canvas).toBeDefined();
    expect(canvas?.isConnected).toBe(false);
  });
});

describe('DOM story gate cleanup', () => {
  it('should propagate delayed rejection and unmount the failing story', async () => {
    let mounted = false;
    let canvas: HTMLElement | undefined;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return createElement('p', null, 'Delayed failure');
    };
    const failure = new Error('Awaited play failure');
    const play = async ({
      canvasElement,
    }: {
      canvasElement: HTMLElement;
    }): Promise<void> => {
      canvas = canvasElement;
      await Promise.resolve();
      expect(mounted).toBe(true);
      expect(canvasElement.textContent).toBe('Delayed failure');
      throw failure;
    };
    const scenario: StoryCase = {
      name: 'Delayed failure',
      module: { default: { title: 'Harness' } },
      story: composeStory(
        { render: () => createElement(Fixture), play },
        { title: 'Harness' },
      ),
      play,
    };
    await expect(executeDomStory(scenario)).rejects.toBe(failure);
    expect(mounted).toBe(false);
    expect(canvas?.isConnected).toBe(false);
  });
});

it('should reject unsupported injection and remove its mounted canvas', async () => {
  const play = vi.fn(async (): Promise<void> => {
    throw new Error('Must not execute');
  });
  const story = composeStory(
    { render: () => createElement('p', null, 'Unsupported component'), play },
    { title: 'Harness' },
  );
  const scenario: StoryCase = {
    name: 'Unsupported component',
    module: { default: { title: 'Harness' } },
    story,
    play,
  };
  await expect(
    executeDomStory(scenario, createDomInteractions),
  ).rejects.toThrow(Error);
  expect(play).not.toHaveBeenCalled();
  expect(document.body.textContent).not.toContain('Unsupported component');
});
