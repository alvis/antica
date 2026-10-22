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
import { formatDateTime } from '../../../utils/calendar';

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
import { hubReads } from './record.spec.fixtures';
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
 * answers the history reads with the given pages and the header's record reads with the fixtures
 * @param read answers each history read by its path
 * @returns a reader for every path the screen reads
 */
function withRecord(
  read: (path: string) => Promise<unknown>,
): (path: string) => Promise<unknown> {
  return async (path) => {
    if (path.startsWith(historyPath)) {
      return read(path);
    }
    if (path.startsWith('/v1/knowledge/')) {
      // an unread title uses a localized fallback
      throw new Error('Knowledge unavailable');
    }

    return path === `/v1/records/${collectionRecord.id}`
      ? collectionRecord
      : hubReads(path);
  };
}

/**
 * lists the history reads made so far, in order
 * @param reads the harness's read spy
 * @returns the path of every history read
 */
function historyReads(reads: { mock: { calls: unknown[][] } }): unknown[] {
  return reads.mock.calls
    .map(([path]) => path)
    .filter((path) => String(path).startsWith(historyPath));
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
    { get: withRecord(read) },
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
  const time = formatDateTime(renamed.occurredAt, 'en');

  expect(historyReads(view.reads)[0]).toBe(`${historyPath}?limit=20`);
  expect(entryText(renamed)).toContain(
    'Applied the analysis suggestion “Name”',
  );
  expect(entryText(renamed)).toContain(time);
  expect(entryText(renamed)).toContain('Not filled in → Blue-and-white vase');
  expect(entryText(renamed)).toContain('Open this analysis');
  expect(
    screen.queryByTestId(`record-history-entry-${describedByVoice.id}`),
  ).toBeNull();
  expect(screen.queryByText(longDescription)).toBeNull();
  expect(
    screen.getByText('8 changes · each leads back to its source'),
  ).toBeVisible();
  expect(
    screen.queryByTestId(
      `record-history-entry-${describedByVoice.id}-description-source`,
    ),
  ).toBeNull();
  expect(entryText(dated)).toContain(
    'Qing → Kangxi (1662–1722) · collector’s claim',
  );
  expect(entryText(datedFrom)).toContain(
    'Not filled in → Late Qing (1850–unknown) · unconfirmed',
  );
  expect(entryText(datedUntil)).toContain(
    'Not filled in → Early Qing (unknown–1700) · unconfirmed',
  );
  expect(entryText(tagged)).toContain('vase, porcelain');
  // unknown knowledge values remain readable without internal identifiers
  await waitFor(() => expect(entryText(material)).toContain('Unknown'));
  expect(entryText(material)).not.toContain(historyMaterialId.slice(0, 8));
  expect(entryText(judged)).toContain('Possibly later → Not filled in');
  for (const [entry, field, status] of [
    [renamed, 'name', 'accepted'],
    [material, 'material-ids', 'accepted'],
    [judged, 'collector-judgment', 'accepted'],
  ] as const) {
    expect(
      screen.getByTestId(`record-history-entry-${entry.id}-${field}-${status}`),
    ).toBeTruthy();
  }
  expect(screen.queryByTestId('record-history-load-more')).toBeNull();
  expect(
    screen.getByLabelText(
      `Name · Accepted, ${time}. Before: Not filled in. After: Blue-and-white vase. Suggested by an analysis`,
    ),
  ).toBeTruthy();
  expect(
    screen.getByTestId(`record-history-entry-${renamed.id}-name-source`),
  ).toHaveTextContent('Open this analysis');
});

it('should open the analysis proposal behind a change', async () => {
  const view = await renderHistory(async () => page([renamed]));

  await fireEvent.press(
    await screen.findByTestId(`record-history-entry-${renamed.id}-name-source`),
  );

  // the source replaces the segment, so back still returns to the record
  expect(view.router.replace).toHaveBeenCalledWith(
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

  expect(view.router.replace).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}/messages?messageId=${historyMessageId}`,
  );
  expect(entryText(taggedByMessage)).toContain(
    'Wrote “Tags” after confirming in Chat',
  );
  expect(entryText(taggedByMessage)).toContain('Open this conversation');
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
  expect(historyReads(view.reads)[1]).toBe(
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

it('should show only the record’s creation when no change was decided', async () => {
  await renderHistory(async () => page([]));

  expect(await screen.findByTestId('record-history-created')).toHaveTextContent(
    /Record added/,
  );
  expect(screen.queryAllByTestId(/^record-history-entry-/)).toHaveLength(0);
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
      get: withRecord(async () => page([describedByVoice, tagged], 'older')),
    },
    savedLanguage('zh-Hant'),
  );

  await screen.findByTestId(`record-history-entry-${tagged.id}`);
  expect(
    screen.queryByTestId(`record-history-entry-${describedByVoice.id}`),
  ).toBeNull();
  expect(screen.getByText('1 筆變更 · 每筆都可回到來源')).toBeVisible();
  expect(entryText(tagged)).toContain('vase、porcelain');
  expect(screen.getByLabelText('變更紀錄')).toBeTruthy();
  expect(screen.getByText('顯示較早的變更')).toBeTruthy();
  expect(historyReads(view.reads)[0]).toContain(historyPath);
});
