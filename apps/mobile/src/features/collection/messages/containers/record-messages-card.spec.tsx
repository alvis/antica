import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import RecordMessagesRoute from '../../../../app/(private)/collection/[recordId]/messages';
import {
  collectionRecord,
  renderMobile,
} from '../../../../mobile.spec.fixtures';

import {
  apiError,
  descriptionChange,
  draftId,
  entry,
  messagesPath,
  nameChange,
  nameChangeId,
  page,
  periodChange,
  periodChangeId,
  recordId,
  sentTo,
  tagsChange,
  tagsChangeId,
} from './record-messages.spec.fixtures';

import type { RecordMessageEntry } from '@antica/contracts';

jest.mock(
  '../../../../providers/AuthProvider',
  () =>
    ({
      useAuth:
        jest.fn<typeof import('../../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
      useLocalSearchParams: jest.fn<
        typeof import('expo-router').useLocalSearchParams
      >(() => ({ recordId: '00000000-0000-4000-8000-000000000001' })),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-crypto',
  () =>
    ({
      randomUUID:
        jest.requireActual<typeof import('node:crypto')>('node:crypto')
          .randomUUID,
    }) satisfies Partial<typeof import('expo-crypto')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({ uri: null }),
  requestRecordingPermissionsAsync: jest.fn(),
  setAudioModeAsync: jest.fn(),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock(
  '../../../../adapters/media-upload',
  () =>
    ({
      uploadMedia:
        jest.fn<
          typeof import('../../../../adapters/media-upload').uploadMedia
        >(),
    }) satisfies Partial<typeof import('../../../../adapters/media-upload')>,
);

const applyPath = `/v1/edit-drafts/${draftId}/apply`;
const changes = [nameChange, periodChange, tagsChange, descriptionChange];

/**
 * renders the message area around one assistant reply with an edit card
 * @param reply assistant reply carrying the proposals
 * @param apply apply handler
 * @returns the rendered harness
 */
async function renderCard(
  reply: RecordMessageEntry,
  apply: () => Promise<unknown> = async () => ({}),
): ReturnType<typeof renderMobile> {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? collectionRecord
        : page([entry('collector', '「青花瓶」名稱'), reply]),
    post: apply,
  });
  await screen.findByTestId(`record-message-card-${draftId}`);

  return view;
}

/**
 * reads the checked state of a confirm or reject choice
 * @param testID automation identifier of the choice
 * @returns whether the choice is checked
 */
function checked(testID: string): boolean | undefined {
  const { accessibilityState } = screen.getByTestId(testID).props as {
    accessibilityState?: { checked?: boolean };
  };

  return accessibilityState?.checked;
}

it('should show every proposed field with nothing preselected, apply confirmed fields, and skip rejected ones', async () => {
  const view = await renderCard(
    entry('assistant', 'Here are some changes.', { proposedChanges: changes }),
  );
  const card = screen.getByTestId(`record-message-card-${draftId}`);

  expect(
    within(card).getByText('Nothing changes until you tap “Apply decisions”.'),
  ).toBeTruthy();
  expect(within(card).getByText('Blue vase')).toBeTruthy();
  expect(within(card).getByText('Kangxi · 1662–1722')).toBeTruthy();
  expect(within(card).getByText('porcelain, blue-and-white')).toBeTruthy();
  expect(within(card).getByText('Old words')).toBeTruthy();
  expect(within(card).getAllByText('(empty)')).toHaveLength(3);
  expect(
    screen.getByTestId(`record-message-card-confirm-${nameChangeId}`),
  ).toHaveAccessibleName('Confirm: Name');
  for (const change of changes) {
    expect(checked(`record-message-card-confirm-${change.id}`)).toBe(false);
    expect(checked(`record-message-card-reject-${change.id}`)).toBe(false);
  }
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('Apply decisions (0)');

  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${nameChangeId}`),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${periodChangeId}`),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-reject-${periodChangeId}`),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${tagsChangeId}`),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${tagsChangeId}`),
  );
  expect(checked(`record-message-card-reject-${periodChangeId}`)).toBe(true);
  expect(checked(`record-message-card-confirm-${periodChangeId}`)).toBe(false);
  expect(checked(`record-message-card-confirm-${tagsChangeId}`)).toBe(false);
  expect(apply).toHaveAccessibleName('Apply decisions (2)');

  await fireEvent.press(apply);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(1));

  const [request] = sentTo(view.commands, applyPath);
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    expectedDraftRevision: 4,
    expectedRecordRevision: collectionRecord.recordRevision,
    selectedProposalIds: [nameChangeId],
    skippedProposalIds: [periodChangeId],
  });
  await waitFor(() =>
    expect(checked(`record-message-card-confirm-${nameChangeId}`)).toBe(false),
  );
  expect(
    view.reads.mock.calls.filter(([path]) => path === `/v1/records/${recordId}`)
      .length,
  ).toBeGreaterThan(1);
});

it('should lock the choices while an apply is in flight', async () => {
  let finish: () => void = () => undefined;
  await renderCard(
    entry('assistant', 'Rename it?', { proposedChanges: [nameChange] }),
    async () =>
      new Promise((resolve) => {
        finish = () => resolve({});
      }),
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${nameChangeId}`),
  );

  await fireEvent.press(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  );

  expect(
    screen.getByTestId(`record-message-card-reject-${nameChangeId}`),
  ).toBeDisabled();
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeDisabled();
  finish();
  await waitFor(() =>
    expect(
      screen.getByTestId(`record-message-card-reject-${nameChangeId}`),
    ).toBeEnabled(),
  );
});

it('should mark applied and skipped rows of a partly settled card as locked', async () => {
  await renderCard(
    entry('assistant', 'Two changes.', {
      status: 'partially_applied',
      proposedChanges: [nameChange, periodChange, tagsChange],
      appliedProposalIds: [nameChangeId],
      skippedProposalIds: [periodChangeId],
    }),
  );

  expect(screen.getByText('Some changes applied')).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-applied-${nameChangeId}`),
  ).toHaveTextContent('✓ Applied');
  expect(
    screen.getByTestId(`record-message-card-skipped-${periodChangeId}`),
  ).toHaveTextContent('✕ Not applied');
  expect(
    screen.getByTestId(`record-message-card-skipped-${periodChangeId}`),
  ).toHaveAccessibleName('Not applied');
  for (const locked of [nameChangeId, periodChangeId]) {
    expect(
      screen.queryByTestId(`record-message-card-confirm-${locked}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`record-message-card-reject-${locked}`),
    ).toBeNull();
  }
  expect(
    screen.queryByTestId(`record-message-card-skipped-${tagsChangeId}`),
  ).toBeNull();
  expect(
    screen.getByTestId(`record-message-card-confirm-${tagsChangeId}`),
  ).toBeEnabled();
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeDisabled();
});

it.each([
  {
    status: 'applied',
    appliedProposalIds: [nameChangeId],
    skippedProposalIds: [periodChangeId],
    text: 'All changes decided; some not applied',
  },
  {
    status: 'applied',
    appliedProposalIds: [nameChangeId, periodChangeId],
    skippedProposalIds: [],
    text: 'All changes applied',
  },
  {
    status: 'partially_applied',
    appliedProposalIds: [nameChangeId],
    skippedProposalIds: [],
    text: 'Some changes applied',
  },
  {
    status: 'partially_applied',
    appliedProposalIds: [],
    skippedProposalIds: [periodChangeId],
    text: 'Some changes decided',
  },
] as const)(
  'should say “$text” for a $status card with $appliedProposalIds.length applied and $skippedProposalIds.length skipped',
  async ({ status, appliedProposalIds, skippedProposalIds, text }) => {
    await renderCard(
      entry('assistant', 'Two changes.', {
        status,
        proposedChanges: [nameChange, periodChange, tagsChange],
        appliedProposalIds: [...appliedProposalIds],
        skippedProposalIds: [...skippedProposalIds],
      }),
    );

    expect(
      screen.getByTestId(`record-message-card-status-${draftId}`),
    ).toHaveTextContent(text);
  },
);

it('should enable the apply action only while a field is confirmed or rejected', async () => {
  await renderCard(
    entry('assistant', 'Two changes.', {
      proposedChanges: [nameChange, periodChange],
    }),
  );
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);
  const reject = screen.getByTestId(
    `record-message-card-reject-${periodChangeId}`,
  );

  expect(apply).toBeDisabled();
  await fireEvent.press(reject);
  expect(apply).toBeEnabled();
  expect(apply).toHaveAccessibleName('Apply decisions (1)');
  await fireEvent.press(reject);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('Apply decisions (0)');
});

it('should skip rejected fields without selecting any and reload only the messages', async () => {
  const view = await renderCard(
    entry('assistant', 'Two changes.', {
      proposedChanges: [nameChange, periodChange],
    }),
  );
  const reads = (path: string): number =>
    view.reads.mock.calls.filter(([called]) => called === path).length;
  const recordPath = `/v1/records/${recordId}`;
  await waitFor(() => expect(reads(recordPath)).toBe(1));
  const threadBefore = reads(messagesPath);
  await fireEvent.press(
    screen.getByTestId(`record-message-card-reject-${periodChangeId}`),
  );

  await fireEvent.press(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  );
  await waitFor(() =>
    expect(reads(messagesPath)).toBeGreaterThan(threadBefore),
  );

  const [request] = sentTo(view.commands, applyPath);
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    expectedDraftRevision: 4,
    expectedRecordRevision: collectionRecord.recordRevision,
    selectedProposalIds: [],
    skippedProposalIds: [periodChangeId],
  });
  expect(reads(recordPath)).toBe(1);
});

it('should show a fully applied card without an apply action', async () => {
  await renderCard(
    entry('assistant', 'Done.', {
      status: 'applied',
      proposedChanges: [nameChange],
      appliedProposalIds: [nameChangeId],
    }),
  );

  expect(screen.getByText('All changes applied')).toBeTruthy();
  expect(
    screen.queryByTestId(`record-message-card-apply-${draftId}`),
  ).toBeNull();
});

it('should show a stale field inline, reload the record and messages, and rebuild the request', async () => {
  const view = await renderCard(
    entry('assistant', 'Rename it?', { proposedChanges: [nameChange] }),
    async () => {
      throw apiError(
        409,
        'REVISION_CONFLICT',
        'Proposed field changed since draft',
      );
    },
  );
  const threadReads = (): number =>
    view.reads.mock.calls.filter(([path]) => path === messagesPath).length;
  const before = threadReads();
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${nameChangeId}`),
  );

  await fireEvent.press(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  );

  expect(
    await screen.findByTestId(`record-message-card-error-${draftId}`),
  ).toHaveTextContent(
    'The item changed after this suggestion. The latest values were reloaded; review them before applying.',
  );
  await waitFor(() => expect(threadReads()).toBeGreaterThan(before));
  await fireEvent.press(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  );
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(2));
  const [first, second] = sentTo(view.commands, applyPath);
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
});

it('should retry an interrupted apply under the same key until the choice changes', async () => {
  const view = await renderCard(
    entry('assistant', 'Rename it?', {
      proposedChanges: [nameChange, tagsChange],
    }),
    async () => {
      throw new TypeError('Network request failed');
    },
  );
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${nameChangeId}`),
  );
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);

  await fireEvent.press(apply);
  expect(
    await screen.findByTestId(`record-message-card-error-${draftId}`),
  ).toHaveTextContent('Connect to the internet and retry.');
  await fireEvent.press(apply);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(2));
  await fireEvent.press(
    screen.getByTestId(`record-message-card-confirm-${tagsChangeId}`),
  );
  expect(
    screen.queryByTestId(`record-message-card-error-${draftId}`),
  ).toBeNull();
  await fireEvent.press(apply);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(3));

  const [first, second, third] = sentTo(view.commands, applyPath);
  expect(second.idempotencyKey).toBe(first.idempotencyKey);
  expect(third.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(third.body.selectedProposalIds).toEqual([nameChangeId, tagsChangeId]);
  expect(third.body.skippedProposalIds).toEqual([]);
});

it('should show replies without proposals as text only', async () => {
  await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? collectionRecord
        : page([entry('assistant', 'I cannot change the code field.')]),
  });

  expect(
    await screen.findByText('I cannot change the code field.'),
  ).toBeTruthy();
  expect(screen.queryByTestId(`record-message-card-${draftId}`)).toBeNull();
});

it('should keep a card’s choices when its list cell is unmounted and mounted again', async () => {
  const question = entry('collector', '「青花瓶」名稱');
  const reply = entry('assistant', 'Rename it?', {
    proposedChanges: [nameChange, periodChange],
  });
  let items = [question, reply];
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? collectionRecord : page(items),
  });
  await fireEvent.press(
    await screen.findByTestId(`record-message-card-confirm-${nameChangeId}`),
  );

  items = [question];
  await act(async () => view.client.invalidateQueries());
  await waitFor(() =>
    expect(screen.queryByTestId(`record-message-card-${draftId}`)).toBeNull(),
  );
  items = [question, reply];
  await act(async () => view.client.invalidateQueries());

  await screen.findByTestId(`record-message-card-${draftId}`);
  expect(checked(`record-message-card-confirm-${nameChangeId}`)).toBe(true);
  expect(checked(`record-message-card-confirm-${periodChangeId}`)).toBe(false);
});
