import { expect } from '@jest/globals';
import { composeStories } from '@storybook/react-native-web-vite';
import { render, userEvent, waitFor } from '@testing-library/react-native';

import { createElement } from 'react';

import type {
  composeStory,
  ReactRenderer,
  StoryObj,
} from '@storybook/react-native-web-vite';

import type { Store_CSFExports } from 'storybook/internal/types';

import type { QueryStateInteractions } from './QueryState.stories';
import type { ScreenInteractions } from './Screen.stories';

/** genuine scoped native render result */
export type NativeView = Awaited<ReturnType<typeof render>>;
/** public portable story with composed arguments and decorators */
export type PortableStory = ReturnType<typeof composeStory>;
/** binds operations to the real mounted native tree */
export type NativeFactory = (
  view: NativeView,
) => QueryStateInteractions | ScreenInteractions;
/** raw CSF module, retaining excluded helper exports */
export type NativeModule = Store_CSFExports<ReactRenderer> &
  Record<string, unknown>;

/** composed native scenario retaining its original play contract */
export interface NativeStoryCase {
  /** original scenario export name */
  name: string;
  /** public composed scenario with actual consumer arguments */
  story: PortableStory;
  /** original export play or inherited metadata play before composition */
  play: StoryObj['play'];
}

/**
 * discovers executable scenarios while retaining original play provenance
 * @param module raw CSF exports
 * @returns nonempty native scenarios
 * @throws {Error} when composition produces no scenarios
 */
export function discoverNativeStories(module: NativeModule): NativeStoryCase[] {
  const stories = Object.entries(
    composeStories(module) as Record<string, PortableStory>,
  ).map(([name, story]) => ({
    name,
    story,
    play: (module[name] as StoryObj).play ?? module.default.play,
  }));
  if (stories.length === 0) {
    throw new Error('No native story scenarios were discovered.');
  }

  return stories;
}

/**
 * executes canonical portable play with native operations and guaranteed unmount
 * @param story composed scenario with actual consumer arguments
 * @param originalPlay raw scenario or meta play before composition
 * @param interactions factory bound to the mounted native tree
 * @returns completion after awaited play and native cleanup
 * @throws {Error} when either play contract is absent
 */
export async function executeNativeStory(
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
    await story.play({ loaded: { interactions: interactions(view) } });
  } finally {
    await view.unmount();
  }
}

/** preserves literal whitespace in native content assertions */
const textOptions = { normalizer: (value: string): string => value };

/**
 * binds query controls and assertions to genuine native nodes
 * @param view mounted query story
 * @returns native operations preserving canonical callback identity
 */
export function createNativeQueryInteractions(
  view: NativeView,
): QueryStateInteractions {
  const user = userEvent.setup();
  let previousFeedback: string | null = null;

  return {
    pressControl: async (label) => {
      await user.press(await view.findByRole('button', { name: label }));
    },
    expectText: async (text) => {
      expect(view.getByText(text, textOptions)).toBeVisible();
    },
    expectNoText: async (text) => {
      expect(view.queryByText(text, textOptions)).toBeNull();
    },
    expectLoading: async () => {
      expect(view.getByRole('progressbar')).toBeVisible();
      expect(view.queryByRole('alert')).toBeNull();
    },
    expectContent: async (text) => {
      expect(view.getByText(text, textOptions)).toBeVisible();
      expect(view.queryByRole('progressbar')).toBeNull();
      expect(view.queryByRole('alert')).toBeNull();
      expect(view.queryByRole('button', { name: /^(Retry|重試)$/ })).toBeNull();
    },
    expectPrivateAlert: async (message, origin) => {
      expect(view.getByRole('alert')).toHaveTextContent(/\S/);
      expect(view.getByRole('alert')).toBeVisible();
      expect(JSON.stringify(view.toJSON())).not.toContain(message);
      expect(JSON.stringify(view.toJSON())).not.toContain(origin);
      expect(view.queryByRole('progressbar')).toBeNull();
    },
    expectRetry: async (label) => {
      expect(view.getByRole('button', { name: label })).toBeVisible();
    },
    expectNoRetry: async (label) => {
      expect(view.queryByRole('button', { name: label })).toBeNull();
    },
    rememberFeedback: async () => {
      const alert = view.getByRole('alert');
      expect(alert).toHaveTextContent(/\S/);
      previousFeedback = JSON.stringify(alert.toJSON());
    },
    expectChangedFeedback: async () => {
      await waitFor(() => {
        const alert = view.getByRole('alert');
        expect(alert).toHaveTextContent(/\S/);
        expect(JSON.stringify(alert.toJSON())).not.toBe(previousFeedback);
      });
    },
    expectRetryCount: async (callback, count) => {
      expect(callback).toHaveBeenCalledTimes(count);
    },
  };
}

/**
 * binds screen content and structural branch assertions without geometry claims
 * @param view mounted screen story
 * @returns native controls, content and accessibility assertions
 */
export function createNativeScreenInteractions(
  view: NativeView,
): ScreenInteractions {
  const user = userEvent.setup();

  return {
    pressControl: async (label) => {
      await user.press(await view.findByRole('button', { name: label }));
    },
    expectText: async (text) => {
      expect(view.getByText(text, textOptions)).toBeVisible();
    },
    expectNoText: async (text) => {
      expect(view.queryByText(text, textOptions)).toBeNull();
    },
    expectHeading: async (title) => {
      expect(view.getByRole('header', { name: title })).toBeVisible();
    },
    expectNoHeading: async () => {
      expect(view.queryByRole('header')).toBeNull();
    },
    expectScrollable: async () => {
      expect(
        view.container.queryAll((node) => node.type === 'RCTScrollView'),
      ).toHaveLength(1);
    },
    expectFixed: async () => {
      expect(
        view.container.queryAll((node) => node.type === 'RCTScrollView'),
      ).toHaveLength(0);
    },
  };
}
