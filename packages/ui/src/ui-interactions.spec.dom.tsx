import { describe, it } from 'vitest';

import actionMeta from './ActionButton.stories.js';
import fieldMeta from './TextField.stories.js';
import {
  createDomInteractions,
  discoverStories,
  executeDomStory,
} from './ui.stories.spec.dom.helpers.js';

import type { StoryModule } from './ui.stories.spec.dom.helpers.js';

const storyModules = import.meta.glob<StoryModule>('./**/*.stories.tsx', {
  eager: true,
});
// only the shared controls have injectable adapters; the other primitives query their canvas
const injectable = new Set([actionMeta.component, fieldMeta.component]);
const stories = discoverStories(storyModules).filter(({ module }) =>
  injectable.has(module.default.component as never),
);

describe('rc:SharedControls injected DOM', () => {
  it.each(stories)('should execute $name interactions', async (scenario) => {
    await executeDomStory(scenario, createDomInteractions);
  });
});
