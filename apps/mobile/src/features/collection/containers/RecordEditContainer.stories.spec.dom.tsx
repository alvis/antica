import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../../../mobile.stories.spec.dom.helpers';

import * as editStories from './RecordEditContainer.stories';

const stories = composeStories(editStories);

describe('RecordEditContainer stories', () => {
  it.each(Object.entries(stories))(
    'should play the %s story against its rendered editor',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        await story.play?.({ canvasElement: canvas });

        expect(
          canvas.querySelector('[data-testid="record-edit"]'),
        ).not.toBeNull();
      });
    },
  );
});
