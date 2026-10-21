import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import {
  relatedCard,
  relatedPage,
  relatedPath,
} from './related-knowledge.spec.fixtures';
import { RelatedKnowledgeContainer } from './RelatedKnowledgeContainer';

jest.mock('../../../providers/AuthProvider', () => ({
  useAuth: jest.fn<typeof import('../../../providers/AuthProvider').useAuth>(),
}));
jest.mock('expo-router', () => ({
  useRouter: jest.fn<typeof import('expo-router').useRouter>(),
}));

it('should keep loading inside the related section', async () => {
  await renderMobile(
    <RelatedKnowledgeContainer recordId={collectionRecord.id} />,
    { relatedKnowledge: async () => new Promise(() => undefined) },
  );

  expect(await screen.findByTestId('record-related-loading')).toBeVisible();
});

it('should display the server no-match reason locally', async () => {
  await renderMobile(
    <RelatedKnowledgeContainer recordId={collectionRecord.id} />,
    {
      relatedKnowledge: async () => ({
        ...relatedPage,
        cards: [],
        reason: 'no_match',
      }),
    },
  );

  expect(await screen.findByTestId('record-related-empty')).toHaveTextContent(
    /match/i,
  );
});

it('should recover a local failure with retry', async () => {
  const get = jest
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(relatedPage);
  await renderMobile(
    <RelatedKnowledgeContainer recordId={collectionRecord.id} />,
    { relatedKnowledge: get },
  );
  await screen.findByTestId('record-related-error');

  await fireEvent.press(screen.getByTestId('record-related-retry'));

  expect(
    await screen.findByTestId(`record-related-open-${relatedCard.entryId}`),
  ).toHaveTextContent(new RegExp(relatedCard.title));
});

it('should show saved card context and open its exact revision without writing', async () => {
  const view = await renderMobile(
    <RelatedKnowledgeContainer
      recordId={collectionRecord.id}
      recordRevision={7}
    />,
    { relatedKnowledge: async () => relatedPage },
  );
  // the record hub's strip card names the entry and why it relates to this record
  const card = await screen.findByTestId(
    `record-related-open-${relatedCard.entryId}`,
  );

  expect(card).toHaveTextContent(new RegExp(relatedCard.title));
  expect(card).toHaveTextContent(/Related: Category ?“Ceramics”/);
  await fireEvent.press(card);

  expect(view.router.push).toHaveBeenCalledWith(
    `/knowledge/${relatedCard.entryId}?view=revision&revision=3`,
  );
  expect(view.relatedReads.mock.calls[0]?.[0]).toBe(
    `${relatedPath}?locale=en&limit=3&recordRevision=7`,
  );
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
});

it.each([
  {
    attachments: Array.from({ length: 6 }, (_, index) => ({
      entryId: relatedCard.entryId,
      revision: 3,
      claimKey: `selected-${index}`,
      citationIds: ['00000000-0000-4000-8000-000000000064'],
    })),
  },
  {
    attachments: Array.from({ length: 3 }, (_, index) => ({
      entryId: `00000000-0000-4000-8000-00000000010${index}`,
      revision: 3,
      claimKey: `selected-${index}`,
      citationIds: ['00000000-0000-4000-8000-000000000064'],
    })),
  },
])(
  'should prevent attaching beyond the claim or entry cap',
  async ({ attachments }) => {
    const onAttach = jest.fn();
    await renderMobile(
      <RelatedKnowledgeContainer
        recordId={collectionRecord.id}
        attachments={attachments}
        onAttach={onAttach}
      />,
      { relatedKnowledge: async () => relatedPage },
    );

    const attach = await screen.findByTestId(
      `record-related-attach-${relatedCard.entryId}`,
    );
    expect(attach).toBeDisabled();
    await fireEvent.press(attach);

    expect(onAttach).not.toHaveBeenCalled();
  },
);

it('should allow reading an uncited card without offering an attachment', async () => {
  const onAttach = jest.fn();
  await renderMobile(
    <RelatedKnowledgeContainer
      recordId={collectionRecord.id}
      onAttach={onAttach}
    />,
    {
      relatedKnowledge: async () => ({
        ...relatedPage,
        cards: [{ ...relatedCard, excerpt: null }],
      }),
    },
  );

  expect(
    await screen.findByTestId(`record-related-open-${relatedCard.entryId}`),
  ).toBeEnabled();
  expect(
    screen.queryByTestId(`record-related-attach-${relatedCard.entryId}`),
  ).toBeNull();
  expect(onAttach).not.toHaveBeenCalled();
});

it('should leave a busy composer selection unchanged', async () => {
  const onAttach = jest.fn();
  await renderMobile(
    <RelatedKnowledgeContainer
      recordId={collectionRecord.id}
      onAttach={onAttach}
      busy
    />,
    { relatedKnowledge: async () => relatedPage },
  );

  const attach = await screen.findByTestId(
    `record-related-attach-${relatedCard.entryId}`,
  );
  expect(attach).toBeDisabled();
  await fireEvent.press(attach);
  expect(onAttach).not.toHaveBeenCalled();
});

it.each([
  { kind: 'concept' as const, label: 'Concept' },
  { kind: 'method' as const, label: 'Method' },
  { kind: 'object_example' as const, label: 'Museum example' },
])(
  'should display the saved $kind with its original-language fallback in the composer tray',
  async ({ kind, label }) => {
    await renderMobile(
      <RelatedKnowledgeContainer
        recordId={collectionRecord.id}
        onAttach={jest.fn()}
      />,
      {
        relatedKnowledge: async () => ({
          ...relatedPage,
          cards: [{ ...relatedCard, kind }],
        }),
      },
    );

    const card = await screen.findByTestId(
      `record-related-${relatedCard.entryId}`,
    );
    expect(card).toHaveTextContent(new RegExp(label));
    expect(card).toHaveTextContent(/Showing original \(zh-Hant\)/);
  },
);

it('should attach the cited claim once and disable the already selected candidate', async () => {
  const onAttach = jest.fn();
  await renderMobile(
    <RelatedKnowledgeContainer
      recordId={collectionRecord.id}
      onAttach={onAttach}
    />,
    { relatedKnowledge: async () => relatedPage },
  );

  await fireEvent.press(
    await screen.findByTestId(`record-related-claim-${relatedCard.entryId}`),
  );

  expect(onAttach).toHaveBeenCalledWith(
    {
      entryId: relatedCard.entryId,
      revision: 3,
      claimKey: 'surface',
      citationIds: ['00000000-0000-4000-8000-000000000064'],
    },
    relatedCard.title,
  );
});

it('should explain an empty saved collection when the server omits a match reason', async () => {
  await renderMobile(
    <RelatedKnowledgeContainer recordId={collectionRecord.id} />,
    { relatedKnowledge: async () => ({ ...relatedPage, cards: [] }) },
  );

  expect(await screen.findByTestId('record-related-empty')).toHaveTextContent(
    /knowledge/i,
  );
});
