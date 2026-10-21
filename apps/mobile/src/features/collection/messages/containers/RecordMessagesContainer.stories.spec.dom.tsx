import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../../../../mobile.stories.spec.dom.helpers';

import * as stories from './RecordMessagesContainer.stories';

const composed = composeStories(stories);

describe('RecordMessagesContainer stories', () => {
  it.each(Object.entries(composed))(
    'should complete the %s interaction in the browser runtime',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        const play = story.play;
        if (!play) {
          throw new Error('Message stories must expose their interaction.');
        }

        await play({ canvasElement: canvas });

        expect(
          canvas.querySelector('[role="alert"]')?.textContent ?? '',
        ).not.toContain('STORY_FIXTURE_MISSING');
      });
    },
  );

  it('should send nothing for an applied card and offer only voice when the composer is empty', async () => {
    await withCanvas(<composed.AllApplied />, async (canvas) => {
      await composed.AllApplied.play?.({ canvasElement: canvas });

      expect(
        canvas.querySelector('[data-testid^="record-message-card-apply-"]'),
      ).toBeNull();
      expect(
        canvas.querySelector('[data-testid="record-message-send"]'),
      ).toBeNull();
      expect(
        canvas.querySelector('[data-testid="record-message-voice"]'),
      ).not.toBeNull();
      expect(canvas.textContent).not.toContain('POST ');
    });
  });
});
