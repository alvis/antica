import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../mobile.stories.spec.dom.helpers';

import * as actionStories from './SettingsAction.stories';

describe('SettingsAction stories', () => {
  it.each(Object.entries(composeStories(actionStories)))(
    'should play the %s story against its rendered gear',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        await story.play?.({ canvasElement: canvas });

        expect(canvas.querySelector('[role="button"]')).not.toBeNull();
      });
    },
  );
});
