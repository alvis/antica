import { composeStories } from '@storybook/react-native-web-vite';

import { createElement } from 'react';

import { describe, expect, it } from 'vitest';

import { withCanvas } from '../../mobile.stories.spec.dom.helpers';

import * as cameraStories from './components/CaptureCamera.stories';
import * as fallbackStories from './components/CaptureCameraFallback.stories';
import * as gridStories from './components/CaptureGridStep.stories';
import * as saveStories from './components/CaptureSaveStep.stories';
import * as resumeStories from './components/UploadResumeBanner.stories';

const scenarios = [
  ...Object.entries(composeStories(cameraStories)),
  ...Object.entries(composeStories(fallbackStories)),
  ...Object.entries(composeStories(gridStories)),
  ...Object.entries(composeStories(saveStories)),
  ...Object.entries(composeStories(resumeStories)),
];

describe('Capture camera, grid, save and resume stories', () => {
  it.each(scenarios)(
    'should play the %s story against its rendered capture screen',
    async (_name, story) => {
      await withCanvas(createElement(story), async (canvas) => {
        await story.play?.({ canvasElement: canvas });

        expect(canvas.querySelector('[role="button"]')).not.toBeNull();
      });
    },
  );
});
