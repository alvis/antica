import { within } from '@storybook/testing-library';

import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { expect as expectDom } from 'storybook/test';

import {
  discoverStories,
  executeDomStory,
  createDomInteractions,
} from '../mobile.stories.spec.dom.helpers';

import type { FC } from 'react';

import type { StoryModule } from '../mobile.stories.spec.dom.helpers';

vi.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: vi.fn<typeof import('expo-secure-store').getItemAsync>(
        async () => null,
      ),
      setItemAsync: vi.fn<typeof import('expo-secure-store').setItemAsync>(
        async () => undefined,
      ),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

const modules = import.meta.glob<StoryModule>(
  './{QueryState,Screen}.stories.tsx',
  { eager: true },
);

describe('rc:MobileComponents canonical fallback DOM plays', () => {
  it.each(discoverStories(modules))(
    'should execute $name interactions',
    async (scenario) => {
      await executeDomStory(scenario);
    },
  );
});

describe('fn:executeDomStory', () => {
  it('should reject empty discovery before rendering', () => {
    expect(() => discoverStories({})).toThrow(Error);
  });

  it('should reject original missing play without rendering', async () => {
    const renderStory = vi.fn(() => <div>Invalid story</div>);
    const [scenario] = discoverStories({
      invalid: {
        default: { title: 'Invalid' },
        Missing: { render: renderStory },
      },
    });
    await expect(executeDomStory(scenario)).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
  });

  it('should reject composed missing play without rendering or playing', async () => {
    const renderStory = vi.fn(() => <div>Invalid story</div>);
    const play = vi.fn(async () => {
      throw new Error('Must not execute');
    });
    const [scenario] = discoverStories({
      invalid: {
        default: { title: 'Invalid' },
        Missing: { render: renderStory, play },
      },
    });
    scenario.story.play = undefined;
    await expect(executeDomStory(scenario)).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('should reject an unsupported injected story before play and release its canvas', async () => {
    const play = vi.fn(async () => {
      throw new Error('Must not execute');
    });
    const [scenario] = discoverStories({
      unsupported: {
        default: { title: 'Unsupported' },
        Content: { render: () => <div>Unsupported content</div>, play },
      },
    });
    await expect(
      executeDomStory(scenario, createDomInteractions),
    ).rejects.toThrow(Error);
    expect(play).not.toHaveBeenCalled();
    expect(document.querySelector('main')).toBeNull();
  });
});

describe('fn:executeDomStory lifecycle', () => {
  it('should execute inherited play and release the successful tree and canvas', async () => {
    let mounted = false;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return <div>Inherited DOM content</div>;
    };
    const [scenario] = discoverStories({
      inherited: {
        default: {
          title: 'Inherited',
          play: async ({ canvasElement }) => {
            expect(mounted).toBe(true);
            await expectDom(
              within(canvasElement).getByText('Inherited DOM content'),
            ).toBeVisible();
          },
        },
        Content: { render: () => <Fixture /> },
      },
    });
    await executeDomStory(scenario);
    expect(mounted).toBe(false);
    expect(document.querySelector('main')).toBeNull();
  });

  it('should await delayed rejection identity and release the tree and canvas', async () => {
    let mounted = false;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return <div>Awaited DOM content</div>;
    };
    const failure = new Error('Delayed DOM rejection');
    const [scenario] = discoverStories({
      rejecting: {
        default: { title: 'Rejecting' },
        Content: {
          render: () => <Fixture />,
          play: async () => {
            await Promise.resolve();
            expect(mounted).toBe(true);
            throw failure;
          },
        },
      },
    });
    await expect(executeDomStory(scenario)).rejects.toBe(failure);
    expect(mounted).toBe(false);
    expect(document.querySelector('main')).toBeNull();
  });
});
