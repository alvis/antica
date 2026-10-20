import { composeStories } from '@storybook/react-native-web-vite';
import { waitFor } from '@storybook/testing-library';

import { expect, it } from 'vitest';

import { withCanvas } from '../../../mobile.stories.spec.dom.helpers';

import * as citationStories from './CitationPanel.stories';
import * as claimStories from './CitedClaim.stories';
import * as resultStories from './KnowledgeResultCard.stories';
import * as imageStories from './RemoteImageReference.stories';
import * as topicStories from './TopicBrowse.stories';

const results = composeStories(resultStories);
const topics = composeStories(topicStories);
const claims = composeStories(claimStories);
const citations = composeStories(citationStories);
const images = composeStories(imageStories);

it('should open a museum result from its rendered fallback card', async () => {
  await withCanvas(
    <results.MuseumExampleWithOriginalFallback />,
    async (canvas) => {
      await results.MuseumExampleWithOriginalFallback.play?.({
        canvasElement: canvas,
      });
      await waitFor(() =>
        expect(canvas.textContent).toContain('Museum example'),
      );
      expect(canvas.textContent).toContain('Showing original');
    },
  );
});

it('should expose a selected topic and invoke its rendered category action', async () => {
  await withCanvas(<topics.Category />, async (canvas) => {
    await topics.Category.play?.({ canvasElement: canvas });
    expect(canvas.textContent).toContain('Ceramics');
  });
  await withCanvas(<topics.SelectedOriginalLabel />, async (canvas) => {
    await waitFor(() =>
      expect(canvas.textContent).toContain('Showing original'),
    );
    expect(
      canvas.querySelector('[data-testid^="knowledge-filter-"]'),
    ).not.toBeNull();
  });
});

it('should show translated and original claim states with source support', async () => {
  await withCanvas(<claims.ReviewedTranslation />, async (canvas) => {
    await waitFor(() =>
      expect(canvas.textContent).toContain('The huanghuali surface is dark.'),
    );
    expect(canvas.textContent).toContain(
      'A later finish may affect appearance.',
    );
  });
  await withCanvas(<claims.OriginalText />, async (canvas) => {
    expect(canvas.textContent).toContain('黃花梨表面呈深色');
  });
  await withCanvas(<claims.NeedsSource />, async (canvas) => {
    await waitFor(() => expect(canvas.textContent).toContain('Source needed'));
  });
});

it('should retain the captured quote and field locator in the citation sheet', async () => {
  await withCanvas(<citations.StructuredSource />, async (canvas) => {
    await waitFor(() =>
      expect(canvas.ownerDocument.body.textContent).toContain(
        'Museum object record',
      ),
    );
    expect(canvas.ownerDocument.body.textContent).toContain('/description');
    expect(canvas.ownerDocument.body.textContent).toContain(
      'A dark surface is visible',
    );
  });
});

it('should show a reserved remote image placeholder and a recoverable failure', async () => {
  await withCanvas(<images.ReservedPlaceholder />, async (canvas) => {
    expect(canvas.textContent).toContain('Museum chair');
    await waitFor(() =>
      expect(canvas.textContent).toContain('Rights not recorded'),
    );
  });
  await withCanvas(<images.FailedRemoteLoad />, async (canvas) => {
    await waitFor(() =>
      expect(canvas.textContent).toContain('Image unavailable'),
    );
    expect(
      canvas.querySelector('[data-testid^="knowledge-image-retry-"]'),
    ).not.toBeNull();
    expect(canvas.textContent).toContain('Museum chair');
  });
});
