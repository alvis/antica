import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { createRoot } from 'react-dom/client';

import queryMeta, {
  createDomQueryStateInteractions,
} from './components/QueryState.stories';
import screenMeta, {
  createDomScreenInteractions,
} from './components/Screen.stories';

import type {
  composeStory,
  ReactRenderer,
  StoryObj,
} from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { Store_CSFExports } from 'storybook/internal/types';

import type { QueryStateInteractions } from './components/QueryState.stories';
import type { ScreenInteractions } from './components/Screen.stories';

/** raw CSF metadata and exports, including excluded interaction factories */
export type StoryModule = Store_CSFExports<ReactRenderer> &
  Record<string, unknown>;
/** public composed scenario retaining its actual consumer arguments */
export type PortableStory = ReturnType<typeof composeStory>;
/** canonical scenario retaining original and composed play contracts separately */
export interface StoryCase {
  /** module and export name for scenario reporting */
  name: string;
  /** original module used to select the owning inline DOM factory */
  module: StoryModule;
  /** composed renderable scenario with its public portable play */
  story: PortableStory;
  /** raw export play or inherited metadata play before composition */
  play: StoryObj['play'];
}
/** binds the owning inline factory to an already mounted real DOM canvas */
export type InteractionFactory = (
  canvas: HTMLElement,
  scenario: StoryCase,
) => QueryStateInteractions | ScreenInteractions;

/**
 * discovers canonical stories through public composition and CSF exclusions
 * @param modules selected raw story modules
 * @returns nonempty registry retaining original plays
 * @throws {Error} when no scenarios are discovered
 */
export function discoverStories(
  modules: Record<string, StoryModule>,
): [StoryCase, ...StoryCase[]] {
  const stories = Object.entries(modules).flatMap(([path, module]) =>
    Object.entries(composeStories(module) as Record<string, PortableStory>).map(
      ([name, story]) => ({
        name: `${path}: ${name}`,
        module,
        story,
        play: (module[name] as StoryObj).play ?? module.default.play,
      }),
    ),
  );
  if (stories.length === 0) {
    throw new Error('No executable story scenarios were discovered.');
  }

  return stories as [StoryCase, ...StoryCase[]];
}

/**
 * runs a story against an attached DOM canvas and disposes its React tree
 * @param element actual composed story element
 * @param exercise user interaction and visible-result assertions
 * @returns completion after interaction and unconditional cleanup
 */
export async function withCanvas(
  element: ReactElement,
  exercise: (canvas: HTMLElement) => Promise<void>,
): Promise<void> {
  const canvas = document.createElement('main');
  document.body.append(canvas);
  const root = createRoot(canvas);
  try {
    flushSync(() => root.render(element));
    await exercise(canvas);
  } finally {
    flushSync(() => root.unmount());
    canvas.remove();
  }
}

/**
 * awaits a canonical play against its actual mounted DOM content
 * @param scenario original and composed play contracts
 * @param interactions optional mounted-canvas interaction factory
 * @returns completion after play and unconditional canvas cleanup
 * @throws {Error} when either original or composed play is absent
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
  const playStory = story.play;
  await withCanvas(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}>
      {createElement(story)}
    </SafeAreaProvider>,
    async (canvasElement) => {
      const loaded = interactions
        ? { interactions: interactions(canvasElement, scenario) }
        : {};
      await playStory({ canvasElement, loaded });
    },
  );
}

/**
 * selects the owning inline factory for an injected DOM execution
 * @param canvas already mounted connected story canvas
 * @param scenario raw metadata and composed scenario
 * @returns genuine DOM operations supplied through loaded.interactions
 * @throws {Error} when the story has no supported factory
 */
export const createDomInteractions: InteractionFactory = (canvas, scenario) => {
  if (scenario.module.default.component === queryMeta.component) {
    return createDomQueryStateInteractions(canvas);
  }
  if (scenario.module.default.component === screenMeta.component) {
    return createDomScreenInteractions(canvas);
  }
  throw new Error(
    `${scenario.story.id} has no injected DOM interaction adapter.`,
  );
};
