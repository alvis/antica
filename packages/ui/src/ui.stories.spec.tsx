import { describe, expect, it, jest } from '@jest/globals';
import { composeStories, composeStory } from '@storybook/react-native-web-vite';
import { render, userEvent } from '@testing-library/react-native';

import { createElement, useEffect } from 'react';
import { Pressable, Text } from 'react-native';

import actionMeta, {
  Primary,
  Secondary,
  Disabled,
} from './ActionButton.stories.js';
import fieldMeta, {
  SingleLine,
  Multiline,
  ReadOnly,
} from './TextField.stories.js';

import type { FC } from 'react';

import type {
  ActionInteractions,
  FieldInteractions,
} from './ui.stories.helpers.js';

type PortableStory = ReturnType<typeof composeStory>;
type NativeView = Awaited<ReturnType<typeof render>>;
type NativeFactory = (
  view: NativeView,
  label: string,
) => ActionInteractions | FieldInteractions;
interface NativeCase {
  name: string;
  story: PortableStory;
  play: unknown;
  interactions: NativeFactory;
}

const actionStories = { Primary, Secondary, Disabled };
const fieldStories = { SingleLine, Multiline, ReadOnly };
const stories: NativeCase[] = [
  ...Object.entries(
    composeStories({ default: actionMeta, ...actionStories }),
  ).map(([name, story]) => ({
    name,
    story,
    play: actionStories[name as keyof typeof actionStories].play,
    interactions: createNativeActionInteractions,
  })),
  ...Object.entries(
    composeStories({ default: fieldMeta, ...fieldStories }),
  ).map(([name, story]) => ({
    name,
    story,
    play: fieldStories[name as keyof typeof fieldStories].play,
    interactions: createNativeFieldInteractions,
  })),
];

describe('rc:SharedControls native canonical plays', () => {
  it.each(requireStories(stories))(
    'should execute $name interactions',
    async ({ story, play, interactions }) => {
      await executeNativeStory(story, play, interactions);
    },
  );
});

/**
 * rejects empty native composition even when unrelated native tests pass
 * @param scenarios composed canonical scenarios
 * @returns the nonempty scenarios
 */
function requireStories(scenarios: NativeCase[]): NativeCase[] {
  if (scenarios.length === 0) {
    throw new Error('No native story scenarios were discovered.');
  }

  return scenarios;
}

/**
 * binds native button operations to an actual rendered story
 * @param view scoped native render result
 * @param label accessible action label
 * @returns native operations and assertions
 */
function createNativeActionInteractions(
  view: NativeView,
  label: string,
): ActionInteractions {
  const button = view.getByRole('button', { name: label });
  const user = userEvent.setup();

  return {
    expectEnabled: async () => {
      expect(button).toBeEnabled();
    },
    expectDisabled: async () => {
      expect(button).toBeDisabled();
    },
    press: async () => {
      await user.press(button);
    },
    attemptDisabledPress: async () => {
      await user.press(button);
    },
    expectCallCount: async (callback, count) => {
      expect(callback).toHaveBeenCalledTimes(count);
    },
    expectVisibleText: async (text) => {
      expect(
        view.getByText(text, { normalizer: (value) => value }),
      ).toBeVisible();
    },
  };
}

/**
 * binds native field operations to an actual rendered story
 * @param view scoped native render result
 * @param label accessible field label
 * @returns native operations and assertions
 */
function createNativeFieldInteractions(
  view: NativeView,
  label: string,
): FieldInteractions {
  const field = view.getByLabelText(label);
  const user = userEvent.setup();

  return {
    clear: async () => {
      await user.clear(field);
    },
    type: async (text) => {
      await user.type(field, text);
    },
    expectValue: async (value) => {
      expect(field).toHaveDisplayValue(value);
    },
    expectReadOnly: async () => {
      expect(field).toHaveProp('editable', false);
    },
    expectMultiline: async () => {
      expect(field).toHaveProp('multiline', true);
    },
    expectLastChangedValue: async (callback, value) => {
      expect(callback).toHaveBeenLastCalledWith(value);
    },
    expectCallCount: async (callback, count) => {
      expect(callback).toHaveBeenCalledTimes(count);
    },
    expectVisibleText: async (text) => {
      expect(
        view.getByText(text, { normalizer: (value) => value }),
      ).toBeVisible();
    },
  };
}

/**
 * executes a canonical play against a genuine native render
 * @param story composed portable story
 * @param originalPlay original scenario play contract
 * @param interactions native interaction factory
 * @returns completion after play and native cleanup
 */
async function executeNativeStory(
  story: PortableStory,
  originalPlay: unknown,
  interactions: NativeFactory,
): Promise<void> {
  if (!originalPlay) {
    throw new Error(`${story.id} must provide an original play function.`);
  }
  if (!story.play) {
    throw new Error(`${story.id} must provide a composed play function.`);
  }
  const view = await render(createElement(story));
  try {
    await story.play({
      loaded: { interactions: interactions(view, story.args.label as string) },
    });
  } finally {
    await view.unmount();
  }
}

describe('native story gate failures', () => {
  it('should reject an empty native registry', () => {
    expect(() => requireStories([])).toThrow(Error);
  });

  it('should reject a story without an original play', async () => {
    const renderStory = jest.fn(Primary.render);
    const story = composeStory(
      { render: renderStory, args: Primary.args },
      actionMeta,
    );
    await expect(
      executeNativeStory(story, undefined, createNativeActionInteractions),
    ).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
  });

  it('should reject a composed story whose play is unavailable', async () => {
    const play = Primary.play;
    const renderStory = jest.fn(Primary.render);
    const story = composeStory({ ...Primary, render: renderStory }, actionMeta);
    story.play = undefined;
    await expect(
      executeNativeStory(story, play, createNativeActionInteractions),
    ).rejects.toThrow(Error);
    expect(renderStory).not.toHaveBeenCalled();
  });

  it('should propagate delayed rejection and unmount the native story', async () => {
    let mounted = false;
    const Fixture: FC = () => {
      useEffect(() => {
        mounted = true;

        return () => {
          mounted = false;
        };
      }, []);

      return (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Harness action">
          <Text>Harness action</Text>
        </Pressable>
      );
    };
    const failure = new Error('Awaited native play failure');
    const play = async (): Promise<void> => {
      await Promise.resolve();
      expect(mounted).toBe(true);
      throw failure;
    };
    const story = composeStory(
      { render: () => <Fixture />, play, args: { label: 'Harness action' } },
      { title: 'Harness' },
    );
    await expect(
      executeNativeStory(story, play, createNativeActionInteractions),
    ).rejects.toBe(failure);
    expect(mounted).toBe(false);
  });
});
