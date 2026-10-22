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

import { proposalFieldTestId } from '../../proposal-field-test-id';

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
const conflictStatus = 409;

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
        ? { ...collectionRecord, description: 'Old words' }
        : page([entry('collector', '「青花瓶」名稱'), reply]),
    post: apply,
  });
  await screen.findByTestId(`record-message-card-${draftId}`);

  return view;
}

/**
 * presses the button with the given automation identifier
 * @param testID automation identifier
 */
async function press(testID: string): Promise<void> {
  await fireEvent.press(screen.getByTestId(testID));
}

it('should show every proposed field with nothing preselected, apply confirmed fields, and skip rejected ones', async () => {
  const view = await renderCard(
    entry('assistant', 'Here are some changes.', { proposedChanges: changes }),
  );
  const card = screen.getByTestId(`record-message-card-${draftId}`);

  expect(within(card).getByText('Suggested changes · 4')).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-status-ready-${draftId}`),
  ).toHaveTextContent('Written only after each row is confirmed');
  expect(within(card).getByText('Blue vase')).toBeTruthy();
  expect(
    within(card).getByText('Kangxi (1662–1722) · unconfirmed'),
  ).toBeTruthy();
  expect(within(card).getByText('porcelain, blue-and-white')).toBeTruthy();
  expect(within(card).getByText('Old words')).toBeTruthy();
  expect(within(card).getAllByText('Not filled in')).toHaveLength(3);
  expect(
    screen.getByTestId(`record-message-card-confirm-name-${nameChangeId}`),
  ).toHaveAccessibleName('Confirm: Name');
  for (const change of changes) {
    const row = `${proposalFieldTestId(change.field)}-${change.id}`;
    expect(
      screen.getByTestId(`record-message-card-confirm-${row}`),
    ).toBeEnabled();
    expect(
      screen.getByTestId(`record-message-card-reject-${row}`),
    ).toBeEnabled();
    expect(
      screen.queryByTestId(`record-message-card-confirmed-${row}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`record-message-card-rejected-${row}`),
    ).toBeNull();
  }
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('4 still to decide');

  await press(`record-message-card-confirm-name-${nameChangeId}`);
  // a changed mind: confirm, undo, then reject
  await press(`record-message-card-confirm-period-${periodChangeId}`);
  await press(`record-message-card-undo-period-${periodChangeId}`);
  await press(`record-message-card-reject-period-${periodChangeId}`);
  // an undone row is undecided again
  await press(`record-message-card-confirm-tags-${tagsChangeId}`);
  await press(`record-message-card-undo-tags-${tagsChangeId}`);
  expect(
    screen.getByTestId(`record-message-card-rejected-period-${periodChangeId}`),
  ).toBeTruthy();
  expect(
    screen.queryByTestId(
      `record-message-card-confirmed-period-${periodChangeId}`,
    ),
  ).toBeNull();
  expect(
    screen.getByTestId(`record-message-card-confirm-tags-${tagsChangeId}`),
  ).toBeEnabled();
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('2 still to decide');

  await press(`record-message-card-reject-tags-${tagsChangeId}`);
  await press(
    `record-message-card-reject-${proposalFieldTestId(descriptionChange.field)}-${descriptionChange.id}`,
  );
  expect(apply).toBeEnabled();
  expect(apply).toHaveAccessibleName('Write 1 confirmed change');

  await fireEvent.press(apply);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(1));

  const [request] = sentTo(view.commands, applyPath);
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    expectedDraftRevision: 4,
    expectedRecordRevision: collectionRecord.recordRevision,
    selectedProposalIds: [nameChangeId],
    skippedProposalIds: [periodChangeId, tagsChangeId, descriptionChange.id],
  });
  await waitFor(() =>
    expect(
      screen.queryByTestId(
        `record-message-card-confirmed-name-${nameChangeId}`,
      ),
    ).toBeNull(),
  );
  expect(
    view.reads.mock.calls.filter(([path]) => path === `/v1/records/${recordId}`)
      .length,
  ).toBeGreaterThan(1);
});

it('should keep the saved chair title until the confirmed name is written', async () => {
  const chairName = {
    ...nameChange,
    field: 'name' as const,
    before: '紅木圈椅',
    proposed: '黃花梨圈椅',
  };
  let record = { ...collectionRecord, name: chairName.before };
  let reply = entry('assistant', 'Suggested changes.', {
    proposedChanges: [chairName, periodChange],
  });
  let finish: () => void = () => undefined;
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? record : page([reply]),
    post: async () =>
      new Promise((resolve) => {
        finish = () => {
          record = {
            ...record,
            name: chairName.proposed,
            recordRevision: record.recordRevision + 1,
          };
          reply = {
            ...reply,
            draft: {
              ...reply.draft,
              status: 'applied',
              appliedProposalIds: [nameChangeId],
              skippedProposalIds: [periodChangeId],
            },
          };
          resolve({});
        };
      }),
  });

  expect(
    await screen.findByRole('header', { name: chairName.before }),
  ).toBeTruthy();
  await press(`record-message-card-confirm-name-${nameChangeId}`);
  expect(view.commands).not.toHaveBeenCalled();
  expect(screen.queryByRole('header', { name: chairName.proposed })).toBeNull();
  await press(`record-message-card-reject-period-${periodChangeId}`);
  await press(`record-message-card-apply-${draftId}`);
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('header', { name: chairName.before })).toBeTruthy();

  await act(async () => finish());

  expect(
    await screen.findByRole('header', { name: chairName.proposed }),
  ).toBeTruthy();
  expect(screen.queryByRole('header', { name: chairName.before })).toBeNull();
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
  await press(`record-message-card-confirm-name-${nameChangeId}`);

  await press(`record-message-card-apply-${draftId}`);

  expect(
    screen.getByTestId(`record-message-card-undo-name-${nameChangeId}`),
  ).toBeDisabled();
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeDisabled();
  finish();
  await waitFor(() =>
    expect(
      screen.getByTestId(`record-message-card-reject-name-${nameChangeId}`),
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

  expect(
    screen.getByTestId(`record-message-card-status-partly-applied-${draftId}`),
  ).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-applied-name-${nameChangeId}`),
  ).toHaveTextContent('Written');
  expect(
    screen.getByTestId(`record-message-card-skipped-period-${periodChangeId}`),
  ).toHaveTextContent('Skipped, not written');
  for (const locked of [`name-${nameChangeId}`, `period-${periodChangeId}`]) {
    for (const control of ['confirm', 'reject', 'undo']) {
      expect(
        screen.queryByTestId(`record-message-card-${control}-${locked}`),
      ).toBeNull();
    }
  }
  expect(
    screen.queryByTestId(`record-message-card-skipped-tags-${tagsChangeId}`),
  ).toBeNull();
  expect(
    screen.getByTestId(`record-message-card-confirm-tags-${tagsChangeId}`),
  ).toBeEnabled();
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('1 still to decide');
});

it.each([
  {
    status: 'applied',
    appliedProposalIds: [nameChangeId],
    skippedProposalIds: [periodChangeId],
    text: 'Done',
    state: 'resolved',
  },
  {
    status: 'applied',
    appliedProposalIds: [nameChangeId, periodChangeId],
    skippedProposalIds: [],
    text: 'Done',
    state: 'applied',
  },
  {
    status: 'partially_applied',
    appliedProposalIds: [nameChangeId],
    skippedProposalIds: [],
    text: 'Written only after each row is confirmed',
    state: 'partly-applied',
  },
  {
    status: 'partially_applied',
    appliedProposalIds: [],
    skippedProposalIds: [periodChangeId],
    text: 'Written only after each row is confirmed',
    state: 'partly-decided',
  },
] as const)(
  'should mark a $status card with $appliedProposalIds.length applied and $skippedProposalIds.length skipped as $state',
  async ({ status, appliedProposalIds, skippedProposalIds, text, state }) => {
    await renderCard(
      entry('assistant', 'Two changes.', {
        status,
        proposedChanges: [nameChange, periodChange, tagsChange],
        appliedProposalIds: [...appliedProposalIds],
        skippedProposalIds: [...skippedProposalIds],
      }),
    );

    expect(
      screen.getByTestId(`record-message-card-status-${state}-${draftId}`),
    ).toHaveTextContent(text);
  },
);

it('should enable the apply action only once every row is decided, and block it again on undo', async () => {
  await renderCard(
    entry('assistant', 'Two changes.', {
      proposedChanges: [nameChange, periodChange],
    }),
  );
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);

  expect(apply).toBeDisabled();
  await press(`record-message-card-reject-period-${periodChangeId}`);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('1 still to decide');
  await press(`record-message-card-confirm-name-${nameChangeId}`);
  expect(apply).toBeEnabled();
  expect(apply).toHaveAccessibleName('Write 1 confirmed change');
  await press(`record-message-card-undo-name-${nameChangeId}`);
  expect(apply).toBeDisabled();
  expect(apply).toHaveAccessibleName('1 still to decide');
  expect(
    screen.getByTestId(`record-message-card-confirm-name-${nameChangeId}`),
  ).toBeEnabled();
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
  await press(`record-message-card-reject-name-${nameChangeId}`);
  await press(`record-message-card-reject-period-${periodChangeId}`);
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);
  expect(apply).toHaveAccessibleName('Skip all · write nothing');

  await fireEvent.press(apply);
  await waitFor(() =>
    expect(reads(messagesPath)).toBeGreaterThan(threadBefore),
  );

  const [request] = sentTo(view.commands, applyPath);
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    expectedDraftRevision: 4,
    expectedRecordRevision: collectionRecord.recordRevision,
    selectedProposalIds: [],
    skippedProposalIds: [nameChangeId, periodChangeId],
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

  expect(screen.getByText('Wrote Name')).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-history-${draftId}`),
  ).toBeTruthy();
  expect(
    screen.queryByTestId(`record-message-card-apply-${draftId}`),
  ).toBeNull();
});

it('should show a stale field inline, reload the record and messages, and rebuild the request', async () => {
  const view = await renderCard(
    entry('assistant', 'Rename it?', { proposedChanges: [nameChange] }),
    async () => {
      throw apiError(
        conflictStatus,
        'REVISION_CONFLICT',
        'Proposed field changed since draft',
      );
    },
  );
  const threadReads = (): number =>
    view.reads.mock.calls.filter(([path]) => path === messagesPath).length;
  const before = threadReads();
  await press(`record-message-card-confirm-name-${nameChangeId}`);

  await press(`record-message-card-apply-${draftId}`);

  expect(
    await screen.findByTestId(`record-message-card-error-${draftId}`),
  ).toHaveTextContent(
    'The item changed after this suggestion. The latest values were reloaded; review them before applying.',
  );
  await waitFor(() => expect(threadReads()).toBeGreaterThan(before));
  await waitFor(() =>
    expect(
      screen.getByTestId(`record-message-card-apply-${draftId}`),
    ).toBeEnabled(),
  );
  await press(`record-message-card-apply-${draftId}`);
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
  await press(`record-message-card-confirm-name-${nameChangeId}`);
  await press(`record-message-card-reject-tags-${tagsChangeId}`);
  const apply = screen.getByTestId(`record-message-card-apply-${draftId}`);

  await fireEvent.press(apply);
  expect(
    await screen.findByTestId(`record-message-card-error-${draftId}`),
  ).toHaveTextContent('Connect to the internet and retry.');
  await waitFor(() => expect(apply).toBeEnabled());
  await fireEvent.press(apply);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(2));
  await waitFor(() => expect(apply).toBeEnabled());
  await press(`record-message-card-undo-tags-${tagsChangeId}`);
  expect(
    screen.queryByTestId(`record-message-card-error-${draftId}`),
  ).toBeNull();
  await press(`record-message-card-confirm-tags-${tagsChangeId}`);
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
    await screen.findByTestId(
      `record-message-card-confirm-name-${nameChangeId}`,
    ),
  );

  items = [question];
  await act(async () => view.client.invalidateQueries());
  await waitFor(() =>
    expect(screen.queryByTestId(`record-message-card-${draftId}`)).toBeNull(),
  );
  items = [question, reply];
  await act(async () => view.client.invalidateQueries());

  await screen.findByTestId(`record-message-card-${draftId}`);
  expect(
    screen.getByTestId(`record-message-card-confirmed-name-${nameChangeId}`),
  ).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-confirm-period-${periodChangeId}`),
  ).toBeEnabled();
});

it('should identify a stale confirmed field, block writing it, and still allow skipping it', async () => {
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}`
        ? { ...collectionRecord, name: 'Saved elsewhere', recordRevision: 2 }
        : page([
            entry('assistant', 'Two changes.', {
              proposedChanges: [nameChange, periodChange],
            }),
          ]),
  });
  await screen.findByTestId(`record-message-card-${draftId}`);
  await press(`record-message-card-confirm-name-${nameChangeId}`);
  await press(`record-message-card-reject-period-${periodChangeId}`);

  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeDisabled();
  expect(
    screen.getByTestId(`record-message-card-stale-${draftId}`),
  ).toHaveTextContent(/Name/);
  expect(view.commands).not.toHaveBeenCalled();

  await press(`record-message-card-undo-name-${nameChangeId}`);
  await press(`record-message-card-reject-name-${nameChangeId}`);
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeEnabled();
  await press(`record-message-card-apply-${draftId}`);
  await waitFor(() => expect(sentTo(view.commands, applyPath)).toHaveLength(1));
  expect(sentTo(view.commands, applyPath)[0].body).toMatchObject({
    expectedRecordRevision: 2,
    selectedProposalIds: [],
    skippedProposalIds: [nameChangeId, periodChangeId],
  });
});

it('should refetch a conflicting record and block the newly stale confirmed row', async () => {
  let record = { ...collectionRecord };
  const reply = entry('assistant', 'Rename it?', {
    proposedChanges: [nameChange],
  });
  const view = await renderMobile(<RecordMessagesRoute />, {
    get: async (path) =>
      path === `/v1/records/${recordId}` ? record : page([reply]),
    post: async () => {
      record = { ...record, name: 'Saved elsewhere', recordRevision: 2 };
      throw apiError(
        conflictStatus,
        'REVISION_CONFLICT',
        'Proposed field changed since draft',
      );
    },
  });
  await screen.findByTestId(`record-message-card-${draftId}`);
  await press(`record-message-card-confirm-name-${nameChangeId}`);
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeEnabled();

  await press(`record-message-card-apply-${draftId}`);
  await screen.findByTestId(`record-message-card-error-${draftId}`);
  expect(
    await screen.findByRole('header', { name: 'Saved elsewhere' }),
  ).toBeTruthy();
  expect(
    screen.getByTestId(`record-message-card-apply-${draftId}`),
  ).toBeDisabled();
  expect(
    screen.getByTestId(`record-message-card-stale-${draftId}`),
  ).toHaveTextContent(/Name/);
  expect(sentTo(view.commands, applyPath)).toHaveLength(1);
});
