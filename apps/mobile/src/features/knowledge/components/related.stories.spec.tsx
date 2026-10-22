import { expect, it, jest } from '@jest/globals';
import { composeStories } from '@storybook/react-native-web-vite';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { createElement } from 'react';

import * as evidenceStories from '../../collection/messages/components/KnowledgeEvidenceCard.stories';

import * as citationStories from './KnowledgeCitations.stories';
import * as cardStories from './RelatedKnowledgeCard.stories';

// stories that preview live knowledge read through a transport that never answers
jest.mock('../../../providers/AuthProvider', () => ({
  AuthProvider: ({ children }: { children: unknown }) => children,
  useAuth: () => ({
    api: { get: async () => new Promise(() => undefined) },
    userId: '00000000-0000-4000-8000-000000000099',
  }),
}));

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const cards = composeStories(cardStories);
const citations = composeStories(citationStories);
const evidence = composeStories(evidenceStories);

it('should render related card states and historical evidence stories', async () => {
  for (const story of [
    ...Object.values(cards),
    ...Object.values(citations),
    ...Object.values(evidence),
  ]) {
    const view = await render(createElement(story));
    try {
      await waitFor(() => expect(view.toJSON()).toBeDefined());
    } finally {
      await view.unmount();
    }
  }
});

it('should expose explicit candidate actions and a captured citation in the stories', async () => {
  const view = await render(createElement(cards.Candidate));
  try {
    const open = await view.findByTestId(
      'record-related-open-00000000-0000-4000-8000-000000000068',
    );
    await fireEvent.press(open);
    await fireEvent.press(
      view.getByTestId(
        'record-related-attach-00000000-0000-4000-8000-000000000068',
      ),
    );
    expect(cardStories.default.args.onOpen).toHaveBeenCalled();
    expect(cardStories.Candidate.args.onAttach).toHaveBeenCalled();
    await fireEvent.press(
      view.getByTestId(
        'record-related-citation-00000000-0000-4000-8000-000000000068-00000000-0000-4000-8000-000000000064',
      ),
    );
    expect(
      await view.findByTestId(
        'knowledge-citation-panel-00000000-0000-4000-8000-000000000064',
      ),
    ).toHaveTextContent(/Museum object record/);
    await fireEvent.press(view.getByRole('button', { name: 'Close' }));
    expect(
      view.queryByTestId(
        'knowledge-citation-panel-00000000-0000-4000-8000-000000000064',
      ),
    ).toBeNull();
  } finally {
    await view.unmount();
  }
});
