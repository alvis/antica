import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../../mobile.stories.spec.dom.helpers';

import * as codeStepStories from './components/LoginCodeStep.stories';

const scenarios = Object.entries(composeStories(codeStepStories));

describe('Auth stories', () => {
  it.each(scenarios)(
    'should play the %s story against its rendered code step',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        await story.play?.({ canvasElement: canvas });

        expect(
          canvas.querySelector('[data-testid="login-verify"]'),
        ).not.toBeNull();
      });
    },
  );
});
