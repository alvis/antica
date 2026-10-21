import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { recordSummarySchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { run, runId } from '../../../saved-analysis.spec.fixtures';

import { analysisJob } from '../../collection/containers/record.spec.fixtures';
import {
  entry,
  nameChange,
  tagsChange,
} from '../../collection/messages/containers/record-messages.spec.fixtures';
import { media } from '../../media/containers/media.spec.fixtures';

import { TodayContainer } from './TodayContainer';

import type { MediaDetail, RecordSummary } from '@antica/contracts';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

// a Tuesday evening on the device clock
const now = new Date('2026-10-20T18:05:00');

/**
 * a recent record of the collector
 * @param id record id
 * @param name record name
 * @returns the shelf summary
 */
function summary(id: string, name: string): RecordSummary {
  return recordSummarySchema.parse({
    id,
    code: 'AC-000005',
    name,
    coverThumbnail: `https://media.example/${id}.jpg`,
    locationLabel: null,
    analysisFreshness: 'current',
    pendingCheckCount: 0,
  });
}

const dish = summary(collectionRecord.id, 'Celadon dish');
const chairId = '00000000-0000-4000-8000-000000000920';
const chair = summary(chairId, 'Huanghuali chair');

/**
 * answers 今天's reads for a collector with the given recent records
 * @param records recent records, newest first
 * @returns the reply for each read
 */
function reads(records: RecordSummary[]): (path: string) => Promise<unknown> {
  return async (path) => {
    if (path.startsWith('/v1/records?')) {
      return { items: records, nextCursor: null };
    }
    if (path === `/v1/records/${dish.id}`) {
      return { ...collectionRecord, latestRunId: runId };
    }
    if (path === `/v1/records/${chairId}`) {
      return { ...collectionRecord, id: chairId };
    }
    if (path === `/v1/analyses/${runId}`) {
      return run;
    }
    if (path.startsWith('/v1/jobs/')) {
      return analysisJob(path);
    }
    if (path === `/v1/records/${chairId}/messages?limit=20`) {
      return {
        items: [
          entry('assistant', 'Two changes', {
            proposedChanges: [nameChange, tagsChange],
          }),
        ],
        nextCursor: null,
      };
    }

    return { items: [], nextCursor: null };
  };
}

it('should list what waits on the collector and open each where they decide it', async () => {
  const view = await renderMobile(<TodayContainer now={now} />, {
    get: reads([dish, chair]),
  });

  const inbox = await screen.findByTestId('today-inbox');
  const analysis = await within(inbox).findByTestId(
    `today-inbox-analysis-${dish.id}`,
  );
  const editCard = await within(inbox).findByTestId(
    `today-inbox-editCard-${chairId}-open`,
  );
  expect(analysis).toHaveAccessibleName(/Celadon dish/);
  expect(editCard).toHaveAccessibleName(
    /^2 changes to confirm，Huanghuali chair/,
  );
  // the greeting counts once every read that decides a card has settled
  expect(
    await screen.findByText(/^Good evening\. Waiting for you: /),
  ).toBeTruthy();

  await fireEvent.press(analysis);
  await fireEvent.press(editCard);
  await fireEvent.press(screen.getByTestId('today-capture'));

  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/analysis/${runId}`],
    [`/collection/${chairId}/messages`],
    ['/capture'],
  ]);
  // nothing on 今天 writes; each card only opens its screen
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
});

it('should greet a new collector with one way to start and no second camera button', async () => {
  const view = await renderMobile(<TodayContainer now={now} />, {
    get: reads([]),
  });

  await fireEvent.press(await screen.findByTestId('today-empty-capture'));

  expect(screen.getByTestId('today-empty')).toBeTruthy();
  expect(screen.queryByTestId('today-capture')).toBeNull();
  expect(screen.queryByTestId('today-inbox')).toBeNull();
  expect(view.router.push).toHaveBeenCalledWith('/capture');
});

it('should never say nothing waits while a record is still read, and count it once it is', async () => {
  const pending: { answer?: (page: unknown) => void } = {};
  const conversation = new Promise((resolve) => {
    pending.answer = resolve;
  });
  const answers = reads([chair]);
  await renderMobile(<TodayContainer now={now} />, {
    get: async (path) =>
      path === `/v1/records/${chairId}/messages?limit=20`
        ? conversation
        : answers(path),
  });

  expect(
    await screen.findByText('Good evening. Checking what is waiting for you…'),
  ).toBeTruthy();
  expect(screen.queryByText(/Nothing is waiting/)).toBeNull();

  pending.answer?.(await answers(`/v1/records/${chairId}/messages?limit=20`));

  expect(
    await screen.findByText(/^Good evening\. Waiting for you: /),
  ).toBeTruthy();
});

it('should count what waits while a finished run is still being dated by its job', async () => {
  const answers = reads([dish]);
  await renderMobile(<TodayContainer now={now} />, {
    get: async (path) =>
      path.startsWith('/v1/jobs/')
        ? new Promise<never>(() => undefined)
        : answers(path),
  });

  expect(
    await screen.findByText(/^Good evening\. Waiting for you: /),
  ).toBeTruthy();
  expect(
    screen.queryByText('Good evening. Checking what is waiting for you…'),
  ).toBeNull();
});

it('should say what could not be read instead of an all-clear, and reread it on retry', async () => {
  let failing = true;
  const answers = reads([chair]);
  const view = await renderMobile(<TodayContainer now={now} />, {
    get: async (path) => {
      if (path === `/v1/records/${chairId}/messages?limit=20` && failing) {
        throw new Error('offline');
      }

      return answers(path);
    },
  });

  expect(
    await screen.findByText(
      'Good evening. Some objects could not be read, so more may be waiting than shown below.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/Nothing is waiting/)).toBeNull();

  failing = false;
  await fireEvent.press(screen.getByTestId('today-greeting-retry'));

  expect(
    await screen.findByTestId(`today-inbox-editCard-${chairId}-open`),
  ).toBeTruthy();
  // only the failed conversation is read again
  expect(
    view.reads.mock.calls.filter(([path]) => path.startsWith('/v1/records?')),
  ).toHaveLength(1);
});

it('should count every record of a collection longer than the shelf', async () => {
  const answers = reads([dish]);
  // the count reads the largest pages the server serves: a full one, then the rest
  const fullPage = 100;
  const rest = 31;
  const pages: Record<string, unknown> = {
    [`/v1/records?limit=${fullPage}`]: {
      items: Array(fullPage).fill(dish),
      nextCursor: 'b',
    },
    [`/v1/records?limit=${fullPage}&cursor=b`]: {
      items: Array(rest).fill(dish),
      nextCursor: null,
    },
  };
  await renderMobile(<TodayContainer now={now} />, {
    get: async (path) =>
      path.startsWith('/v1/records?limit=12')
        ? { items: [dish], nextCursor: 'a' }
        : (pages[path] ?? answers(path)),
  });

  expect(await screen.findByText('All 131')).toBeTruthy();
});

it('should read one photo for an analysis card instead of every medium of its record', async () => {
  const photo = (id: string, purpose: 'object' | 'receipt'): MediaDetail => ({
    ...media,
    asset: { ...media.asset, id, kind: 'photo', purpose },
    reads: [{ ...media.reads[0], url: `https://private.example/${id}` }],
  });
  const receipt = '00000000-0000-4000-8000-000000000931';
  const front = '00000000-0000-4000-8000-000000000932';
  const side = '00000000-0000-4000-8000-000000000933';
  const details: Record<string, MediaDetail> = {
    [`/v1/media/${receipt}`]: photo(receipt, 'receipt'),
    [`/v1/media/${front}`]: photo(front, 'object'),
    [`/v1/media/${side}`]: photo(side, 'object'),
  };
  const answers = reads([dish]);
  const view = await renderMobile(<TodayContainer now={now} />, {
    get: async (path) =>
      path === `/v1/records/${dish.id}`
        ? {
            ...collectionRecord,
            latestRunId: runId,
            mediaIds: [receipt, front, side],
          }
        : (details[path] ?? answers(path)),
  });

  await screen.findByTestId(`today-inbox-analysis-${dish.id}`);

  // the receipt is passed over and the front photo fills the card; the side photo is never read
  await waitFor(() =>
    expect(JSON.stringify(screen.toJSON())).toContain(
      `https://private.example/${front}`,
    ),
  );
  expect(
    view.reads.mock.calls
      .map(([path]) => path)
      .filter((path) => path.startsWith('/v1/media/')),
  ).toEqual([`/v1/media/${receipt}`, `/v1/media/${front}`]);
});
