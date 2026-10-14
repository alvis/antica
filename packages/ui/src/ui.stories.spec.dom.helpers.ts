import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';
import { flushSync } from 'react-dom';

import { createRoot } from 'react-dom/client';

import actionMeta, {
  createDomActionInteractions,
} from './ActionButton.stories.js';
import fieldMeta, { createDomFieldInteractions } from './TextField.stories.js';

import type {
  composeStory,
  ReactRenderer,
  StoryObj,
} from '@storybook/react-native-web-vite';

import type { Store_CSFExports } from 'storybook/internal/types';

import type { StoryInteractions } from './ui.stories.helpers.js';

/** raw CSF metadata and named exports, including exports excluded from stories */
export type StoryModule = Store_CSFExports<ReactRenderer> &
  Record<string, unknown>;
/** composed renderable scenario with Storybook's portable play callable */
export type PortableStory = ReturnType<typeof composeStory>;
/** discovered scenario retaining both raw and composed play contracts */
export interface StoryCase {
  /** module path and scenario export name used in test reporting */
  name: string;
  /** original CSF exports used to select the owning interaction adapter */
  module: StoryModule;
  /** composed renderable scenario whose play is checked separately */
  story: PortableStory;
  /** raw scenario play or meta-inherited play, before portable composition */
  play: StoryObj['play'];
}
/**
 * binds interaction operations to a scenario's already mounted DOM canvas
 * @param canvas connected canvas containing the rendered scenario
 * @param scenario original module and composed scenario being executed
 * @returns operations supplied to the canonical play through loaded.interactions
 */
export type InteractionFactory = (
  canvas: HTMLElement,
  scenario: StoryCase,
) => StoryInteractions;

/**
 * discovers scenarios from real CSF modules, rejecting an empty registry
 * @param modules discovered story modules
 * @returns scenarios retaining their original play contracts
 */
export function discoverStories(
  modules: Record<string, StoryModule>,
): [StoryCase, ...StoryCase[]] {
  const stories = Object.entries(modules).flatMap(([path, storyModule]) =>
    Object.entries(
      composeStories(storyModule) as Record<string, PortableStory>,
    ).map(([name, story]) => ({
      name: `${path}: ${name}`,
      story,
      module: storyModule,
      play: (storyModule[name] as StoryObj).play ?? storyModule.default.play,
    })),
  );
  if (stories.length === 0) {
    throw new Error('No executable story scenarios were discovered.');
  }

  return stories as [StoryCase, ...StoryCase[]];
}

/**
 * mounts a scenario and awaits its canonical play, always releasing its canvas
 * @param scenario composed scenario and original play contract
 * @param interactions optional actual DOM adapter factory
 * @returns completion after play and cleanup
 */
export async function executeDomStory(
  scenario: StoryCase,
  interactions?: InteractionFactory,
): Promise<void> {
  const { story, play } = scenario;
  if (!play) {
    throw new Error(`${story.id} must provide an original play function.`);
  }
  if (!story.play) {
    throw new Error(`${story.id} must provide a composed play function.`);
  }
  const canvasElement = document.createElement('main');
  document.body.append(canvasElement);
  const root = createRoot(canvasElement);
  try {
    flushSync(() => root.render(createElement(story)));
    const loaded = interactions
      ? { interactions: interactions(canvasElement, scenario) }
      : {};
    await story.play({ canvasElement, loaded });
  } finally {
    flushSync(() => root.unmount());
    canvasElement.remove();
  }
}

/**
 * binds injected operations to the owning story module's actual DOM factory
 * @param canvas mounted DOM canvas
 * @param scenario original module and composed story
 * @returns the component's DOM interaction service
 */
export const createDomInteractions: InteractionFactory = (canvas, scenario) => {
  if (scenario.module.default.component === actionMeta.component) {
    return createDomActionInteractions(
      canvas,
      scenario.story.args.label as string,
    );
  }
  if (scenario.module.default.component === fieldMeta.component) {
    return createDomFieldInteractions(
      canvas,
      scenario.story.args.label as string,
    );
  }
  throw new Error(
    `${scenario.story.id} has no injected DOM interaction adapter.`,
  );
};
