import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../../mobile.stories.spec.dom.helpers';

import * as optionStories from './components/LanguageOption.stories';
import * as languageStories from './containers/LanguageSettingsContainer.stories';
import * as settingsStories from './containers/SettingsContainer.stories';

const scenarios = [
  ...Object.entries(composeStories(languageStories)),
  ...Object.entries(composeStories(settingsStories)),
  ...Object.entries(composeStories(optionStories)),
];

describe('Settings stories', () => {
  it.each(scenarios)(
    'should play the %s story against its rendered screen',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        await story.play?.({ canvasElement: canvas });

        expect(
          canvas.querySelector('[role="radio"], [role="button"]'),
        ).not.toBeNull();
      });
    },
  );
});
