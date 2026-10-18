import { expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import RecordHistoryRoute from '../../../app/(private)/collection/[recordId]/history';
import {
  collectionRecord,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';

import {
  dated,
  datedFrom,
  datedUntil,
  describedByVoice,
  historyMaterialId,
  historyMessageId,
  historyPath,
  historyProposalId,
  historyRunId,
  judged,
  longDescription,
  material,
  renamed,
  tagged,
  taggedByMessage,
} from './record-history.spec.fixtures';
import { RecordHistoryContainer } from './RecordHistoryContainer';

import type { RecordHistoryEntry } from '@antica/contracts';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));

/**
 * builds one history page
 * @param items entries on the page, newest first
 * @param nextCursor cursor of the next, older page
 * @returns the page as the API returns it
 */
function page(
  items: RecordHistoryEntry[],
  nextCursor: string | null = null,
): { items: RecordHistoryEntry[]; nextCursor: string | null } {
  return { items, nextCursor };
}

/**
 * renders the history screen of the fixture record
 * @param read answers each history read by its path
 * @returns the test harness
 */
async function renderHistory(
  read: (path: string) => Promise<unknown>,
): ReturnType<typeof renderMobile> {
  return renderMobile(
    <RecordHistoryContainer recordId={collectionRecord.id} />,
    { get: read },
  );
}

/**
 * reads the text of one entry card
 * @param entry entry whose card is read
 * @returns every text inside the card
 */
function entryText(entry: RecordHistoryEntry): string {
  return within(screen.getByTestId(`record-history-entry-${entry.id}`))
    .getAllByText(/.+/)
    .map((node) => String(node.props.children))
    .join(' | ');
}

it('should show each change with its field, values, decision, time, and source', async () => {
  const view = await renderHistory(async () =>
    page([
      renamed,
      describedByVoice,
      dated,
      datedFrom,
      datedUntil,
      tagged,
      material,
      judged,
    ]),
  );
  await screen.findByTestId('record-history');
  const time = new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(Date.parse(renamed.occurredAt));

  expect(view.reads.mock.calls[0]?.[0]).toBe(`${historyPath}?limit=20`);
  expect(entryText(renamed)).toContain('Name · Accepted');
  expect(entryText(renamed)).toContain(time);
  expect(entryText(renamed)).toContain('Before | (empty) | After');
  expect(entryText(renamed)).toContain('Blue-and-white vase');
  expect(entryText(renamed)).toContain('Suggested by an analysis');
  expect(entryText(describedByVoice)).toContain('Description · Skipped');
  expect(entryText(describedByVoice)).toContain(longDescription);
  expect(entryText(describedByVoice)).toContain('Edited by voice or message');
  expect(
    screen.queryByTestId(
      `record-history-entry-${describedByVoice.id}-description-source`,
    ),
  ).toBeNull();
  expect(entryText(dated)).toContain(
    'Qing · unconfirmed | After | Kangxi (1662–1722) · collector’s claim',
  );
  expect(entryText(datedFrom)).toContain(
    'Late Qing (1850–unknown) · unconfirmed',
  );
  expect(entryText(datedUntil)).toContain(
    'Early Qing (unknown–1700) · unconfirmed',
  );
  expect(entryText(tagged)).toContain('vase, porcelain');
  expect(entryText(material)).toContain(historyMaterialId);
  expect(entryText(judged)).toContain('Possibly later | After | (empty)');
  expect(screen.queryByTestId('record-history-load-more')).toBeNull();
  expect(
    screen.getByLabelText(
      `Name · Accepted, ${time}. Before: (empty). After: Blue-and-white vase. Suggested by an analysis`,
    ),
  ).toBeTruthy();
  expect(
    screen.getByTestId(`record-history-entry-${renamed.id}-name-source`),
  ).toHaveAccessibleName(`Open the suggestion: Name, ${time}`);
});

it('should open the analysis proposal behind a change', async () => {
  const view = await renderHistory(async () => page([renamed]));

  await fireEvent.press(
    await screen.findByTestId(`record-history-entry-${renamed.id}-name-source`),
  );

  expect(view.router.push).toHaveBeenCalledWith(
    `/analysis/${historyRunId}?proposalId=${historyProposalId}`,
  );
});

it('should open the message that requested an edit, and offer nothing for a voice-only edit', async () => {
  const view = await renderHistory(async () =>
    page([taggedByMessage, describedByVoice]),
  );

  await fireEvent.press(
    await screen.findByTestId(
      `record-history-entry-${taggedByMessage.id}-tags-source`,
    ),
  );

  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}/messages?messageId=${historyMessageId}`,
  );
  expect(entryText(taggedByMessage)).toContain('Edited by voice or message');
  expect(
    screen.queryByTestId(
      `record-history-entry-${describedByVoice.id}-description-source`,
    ),
  ).toBeNull();
});

it('should load older changes through the cursor and stop at the last page', async () => {
  let finishOlder: () => void = () => undefined;
  const view = await renderHistory(async (path) =>
    path.includes('cursor=')
      ? new Promise((resolve) => {
          finishOlder = () => resolve(page([dated]));
        })
      : page([renamed], 'older/page'),
  );
  const more = await screen.findByTestId('record-history-load-more');

  await fireEvent.press(more);
  await waitFor(() => expect(more).toBeDisabled());
  expect(within(more).getByText('Loading…')).toBeTruthy();
  await act(async () => finishOlder());

  expect(
    await screen.findByTestId(`record-history-entry-${dated.id}`),
  ).toBeTruthy();
  expect(view.reads.mock.calls[1]?.[0]).toBe(
    `${historyPath}?limit=20&cursor=older%2Fpage`,
  );
  expect(screen.getByTestId(`record-history-entry-${renamed.id}`)).toBeTruthy();
  expect(screen.queryByTestId('record-history-load-more')).toBeNull();
});

it('should keep the shown changes when an older page fails and retry it', async () => {
  let olderFails = true;
  await renderHistory(async (path) => {
    if (!path.includes('cursor=')) {
      return page([renamed], 'older');
    }
    if (olderFails) {
      throw new Error('History connection lost');
    }

    return page([dated]);
  });

  await fireEvent.press(await screen.findByTestId('record-history-load-more'));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This page could not load. Check your connection and try again.',
  );
  expect(screen.getByTestId(`record-history-entry-${renamed.id}`)).toBeTruthy();
  olderFails = false;
  await fireEvent.press(screen.getByTestId('record-history-load-more'));

  expect(
    await screen.findByTestId(`record-history-entry-${dated.id}`),
  ).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('should keep the shown changes and offer a retry when a background refresh fails', async () => {
  let refreshFails = false;
  const view = await renderHistory(async () => {
    if (refreshFails) {
      throw new Error('Refresh connection lost');
    }

    return page([renamed]);
  });
  await screen.findByTestId(`record-history-entry-${renamed.id}`);
  refreshFails = true;

  await act(async () => {
    await view.client.refetchQueries();
  });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Couldn’t refresh.',
  );
  expect(screen.getByTestId(`record-history-entry-${renamed.id}`)).toBeTruthy();
  refreshFails = false;
  await fireEvent.press(screen.getByTestId('record-history-refresh-retry'));

  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByTestId(`record-history-entry-${renamed.id}`)).toBeTruthy();
});

it('should explain an empty history', async () => {
  await renderHistory(async () => page([]));

  expect(
    await screen.findByText(
      'No suggestions have been accepted or skipped yet.',
    ),
  ).toBeTruthy();
});

it('should retry a history that could not be read', async () => {
  let fails = true;
  await renderHistory(async () => {
    if (fails) {
      throw new Error('History unavailable');
    }

    return page([renamed]);
  });

  await screen.findByRole('alert');
  fails = false;
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

  await waitFor(() =>
    expect(
      screen.getByTestId(`record-history-entry-${renamed.id}`),
    ).toBeTruthy(),
  );
});

it('should show the history of the routed record in Traditional Chinese', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(
    <RecordHistoryRoute />,
    {
      get: async () => page([describedByVoice, tagged], 'older'),
    },
    savedLanguage('zh-Hant'),
  );

  await waitFor(() =>
    expect(entryText(describedByVoice)).toContain('描述 · 已略過'),
  );
  expect(entryText(describedByVoice)).toContain('透過語音或訊息編輯');
  expect(entryText(tagged)).toContain('vase、porcelain');
  expect(screen.getByText('變更紀錄')).toBeTruthy();
  expect(screen.getByText('顯示較早的變更')).toBeTruthy();
  expect(view.reads.mock.calls[0]?.[0]).toContain(historyPath);
});
