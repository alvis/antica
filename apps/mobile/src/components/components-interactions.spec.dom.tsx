import { describe, it, vi } from 'vitest';

import {
  discoverStories,
  executeDomStory,
  createDomInteractions,
} from '../mobile.stories.spec.dom.helpers';

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

describe('rc:MobileComponents canonical injected DOM plays', () => {
  it.each(discoverStories(modules))(
    'should execute $name interactions',
    async (scenario) => {
      await executeDomStory(scenario, createDomInteractions);
    },
  );
});
