import { expect, it, jest } from '@jest/globals';
import { composeStories } from '@storybook/react-native-web-vite';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { createElement } from 'react';

import * as citationStories from './CitationPanel.stories';
import * as claimStories from './CitedClaim.stories';
import * as resultStories from './KnowledgeResultCard.stories';
import * as imageStories from './RemoteImageReference.stories';
import * as topicStories from './TopicBrowse.stories';

import type { ReactNode } from 'react';

jest.mock('../../../providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: ReactNode }): ReactNode => children,
  useAuth: jest.fn(),
}));

const results = composeStories(resultStories);
const topics = composeStories(topicStories);
const claims = composeStories(claimStories);
const citations = composeStories(citationStories);
const images = composeStories(imageStories);

/**
 * Runs the portable Storybook interaction with its browser serialization guard.
 * @param play Portable Storybook play action.
 */
async function runBrowserInstrumentedPlay(
  play: () => Promise<void>,
): Promise<void> {
  const windowDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'window',
  );
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      /** minimal element type for Storybook's native-test serialization */
      HTMLElement: class StoryElement {},
    },
  });
  try {
    await play();
  } finally {
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  }
}

it('should execute the museum-result story action on a mounted native card', async () => {
  const view = await render(
    createElement(results.MuseumExampleWithOriginalFallback),
  );
  const click = jest.fn(() => {
    void fireEvent.press(view.getByRole('button', { name: 'View' }));
  });
  const canvasElement = {
    querySelector: () => ({ click }),
  } as unknown as HTMLElement;

  try {
    await runBrowserInstrumentedPlay(async () =>
      results.MuseumExampleWithOriginalFallback.play?.({ canvasElement }),
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(view.getByText(/Showing original/)).toBeTruthy();
  } finally {
    await view.unmount();
  }
});

it('should execute the category story action and render selected fallback topics', async () => {
  const category = await render(createElement(topics.Category));
  const click = jest.fn(() => {
    void fireEvent.press(category.getByRole('button', { name: 'Ceramics' }));
  });
  const canvasElement = {
    querySelector: () => ({ click }),
  } as unknown as HTMLElement;
  try {
    await runBrowserInstrumentedPlay(async () =>
      topics.Category.play?.({ canvasElement }),
    );
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    await category.unmount();
  }

  const selected = await render(createElement(topics.SelectedOriginalLabel));
  try {
    expect(selected.getByText(/Showing original/)).toBeTruthy();
    expect(
      selected.getByTestId(
        `knowledge-filter-${topicStories.default.args.topics[0].id}`,
      ),
    ).toHaveProp('accessibilityState', { selected: true });
  } finally {
    await selected.unmount();
  }
});

it('should render translated, original, and unsupported claim stories', async () => {
  for (const [story, text] of [
    [claims.ReviewedTranslation, 'The huanghuali surface is dark.'],
    [claims.OriginalText, '黃花梨表面呈深色'],
    [claims.NeedsSource, 'Source needed'],
  ] as const) {
    const view = await render(createElement(story));
    try {
      expect(view.getByText(new RegExp(text))).toBeTruthy();
    } finally {
      await view.unmount();
    }
  }
});

it('should render captured citation evidence in both source stories', async () => {
  for (const story of [
    citations.StructuredSource,
    citations.UnavailableUpstream,
  ]) {
    const view = await render(createElement(story));
    try {
      expect(view.getByText('Museum object record')).toBeTruthy();
      expect(view.getByText(/\/description/)).toBeTruthy();
    } finally {
      await view.unmount();
    }
  }
});

it('should render the remote placeholder and a recoverable failure story', async () => {
  const placeholder = await render(createElement(images.ReservedPlaceholder));
  try {
    expect(placeholder.getByText('Museum chair')).toBeTruthy();
    expect(placeholder.getByText('Rights not recorded')).toBeTruthy();
  } finally {
    await placeholder.unmount();
  }

  const failure = await render(createElement(images.FailedRemoteLoad));
  try {
    await waitFor(() =>
      expect(failure.getByText('Image unavailable')).toBeTruthy(),
    );
    expect(failure.getByTestId(/^knowledge-image-retry-/)).toBeTruthy();
  } finally {
    await failure.unmount();
  }
});
