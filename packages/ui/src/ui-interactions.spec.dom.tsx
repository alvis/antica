import { describe, it } from 'vitest';

import {
  createDomInteractions,
  discoverStories,
  executeDomStory,
} from './ui.stories.spec.dom.helpers.js';

import type { StoryModule } from './ui.stories.spec.dom.helpers.js';

const storyModules = import.meta.glob<StoryModule>('./**/*.stories.tsx', {
  eager: true,
});
const stories = discoverStories(storyModules);

describe('rc:SharedControls injected DOM', () => {
  it.each(stories)('should execute $name interactions', async (scenario) => {
    await executeDomStory(scenario, createDomInteractions);
  });
});
