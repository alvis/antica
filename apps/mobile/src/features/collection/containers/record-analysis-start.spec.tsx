import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@antica/client';

import { collectionRecord } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import { mediaId, newRunId, openRecord } from './record-analysis.spec.fixtures';

import type { RecordDetail } from '@antica/contracts';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

it.each([
  [
    'an unreachable service',
    new TypeError('Network request failed'),
    'Connect to the internet and retry.',
  ],
  [
    'a server refusal',
    new ApiError({
      status: 503,
      code: 'PROVIDER_UNAVAILABLE',
      message: 'Analysis provider unavailable',
    }),
    'The service is temporarily unavailable. Try again later.',
  ],
])(
  'should explain a start failure from %s in the collector language and keep Analyse',
  async (_case, failure, message) => {
    const view = await openRecord({
      latestRunId: null,
      analysisFreshness: 'unanalyzed',
    });
    view.commands.mockRejectedValueOnce(failure);
    await waitFor(() =>
      expect(screen.getByTestId('record-analyse')).toBeTruthy(),
    );

    await fireEvent.press(screen.getByTestId('record-analyse'));

    await waitFor(() =>
      expect(screen.getByTestId('record-analyse-error')).toHaveTextContent(
        message,
      ),
    );
    expect(screen.queryByText(failure.message)).toBeNull();
    expect(screen.getByTestId('record-analyse')).toBeEnabled();
    expect(view.router.push).not.toHaveBeenCalled();
  },
);

/**
 * builds the conflict a start request meets after the record moved on
 * @returns a revision conflict
 */
const revisionConflict = (): ApiError =>
  new ApiError({
    status: 409,
    code: 'REVISION_CONFLICT',
    message: 'Record changed before analysis request',
  });

/**
 * makes the record read return the given changes from now on, as if saved elsewhere
 * @param view mobile harness of the open record
 * @param changes record fields the server now holds
 */
function saveElsewhere(
  view: Awaited<ReturnType<typeof openRecord>>,
  changes: Partial<RecordDetail>,
): void {
  const reads = view.reads.getMockImplementation();
  view.reads.mockImplementation(async (path, ...rest) =>
    path === `/v1/records/${collectionRecord.id}`
      ? {
          ...collectionRecord,
          mediaIds: [mediaId],
          latestRunId: null,
          analysisFreshness: 'unanalyzed',
          ...changes,
        }
      : path.startsWith('/v1/media/')
        ? media
        : reads?.(path, ...rest),
  );
}

it('should send the revision on screen and retry once when only background processing moved it', async () => {
  const view = await openRecord({
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
    recordRevision: 4,
  });
  await waitFor(() =>
    expect(screen.getByTestId('record-analyse')).toBeTruthy(),
  );
  // media processing bumps the counters but leaves fields, media and checks as shown
  saveElsewhere(view, {
    recordRevision: 6,
    analysisInputVersion: 3,
    evidenceVersion: 3,
    updatedAt: '2026-10-17T09:00:00.000Z',
  });
  view.commands.mockRejectedValueOnce(revisionConflict());

  await fireEvent.press(screen.getByTestId('record-analyse'));

  await waitFor(() =>
    expect(view.router.push).toHaveBeenCalledWith(`/analysis/${newRunId}`),
  );
  expect(view.commands).toHaveBeenCalledTimes(2);
  const [first, second] = view.commands.mock.calls.map(
    (call) => call[2] as { body: unknown; idempotencyKey: string },
  );
  expect(first).toMatchObject({ body: { expectedRecordRevision: 4 } });
  expect(second).toMatchObject({ body: { expectedRecordRevision: 6 } });
  expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
  expect(screen.queryByTestId('record-analyse-error')).toBeNull();
});

it('should retry a lost start reply with the same request key', async () => {
  const view = await openRecord({
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
    recordRevision: 4,
  });
  await waitFor(() =>
    expect(screen.getByTestId('record-analyse')).toBeTruthy(),
  );
  view.commands.mockRejectedValueOnce(new TypeError('Network request failed'));
  await fireEvent.press(screen.getByTestId('record-analyse'));
  await waitFor(() =>
    expect(screen.getByTestId('record-analyse-error')).toBeTruthy(),
  );

  await fireEvent.press(screen.getByTestId('record-analyse'));

  await waitFor(() =>
    expect(view.router.push).toHaveBeenCalledWith(`/analysis/${newRunId}`),
  );
  const [first, second] = view.commands.mock.calls.map(
    (call) => (call[2] as { idempotencyKey: string }).idempotencyKey,
  );
  expect(second).toBe(first);
});

it.each([
  [
    'new media',
    { mediaIds: [mediaId, '00000000-0000-4000-8000-000000000077'] },
  ],
  ['a changed description', { description: 'Edited on another phone' }],
] satisfies Array<[string, Partial<RecordDetail>]>)(
  'should show the refreshed record with Analyse again instead of analysing unseen %s',
  async (_case, changes) => {
    const view = await openRecord({
      latestRunId: null,
      analysisFreshness: 'unanalyzed',
      recordRevision: 4,
    });
    await waitFor(() =>
      expect(screen.getByTestId('record-analyse')).toBeTruthy(),
    );
    saveElsewhere(view, { recordRevision: 7, ...changes });
    view.commands.mockRejectedValueOnce(revisionConflict());

    await fireEvent.press(screen.getByTestId('record-analyse'));

    await waitFor(() =>
      expect(screen.getByTestId('record-analyse-error')).toHaveTextContent(
        'This item changed since you opened it. Check the update, then analyze again.',
      ),
    );
    expect(view.commands).toHaveBeenCalledTimes(1);
    expect(view.router.push).not.toHaveBeenCalled();
    expect(screen.getByTestId('record-analyse')).toBeEnabled();

    await fireEvent.press(screen.getByTestId('record-analyse'));

    await waitFor(() =>
      expect(view.router.push).toHaveBeenCalledWith(`/analysis/${newRunId}`),
    );
    expect(view.commands.mock.calls[1]?.[2]).toMatchObject({
      body: { expectedRecordRevision: 7 },
    });
  },
);

it('should stop after one automatic retry when the record keeps moving', async () => {
  const view = await openRecord({
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
    recordRevision: 4,
  });
  await waitFor(() =>
    expect(screen.getByTestId('record-analyse')).toBeTruthy(),
  );
  saveElsewhere(view, { recordRevision: 5 });
  view.commands
    .mockRejectedValueOnce(revisionConflict())
    .mockRejectedValueOnce(revisionConflict());

  await fireEvent.press(screen.getByTestId('record-analyse'));

  await waitFor(() =>
    expect(screen.getByTestId('record-analyse-error')).toHaveTextContent(
      'This item changed since you opened it. Check the update, then analyze again.',
    ),
  );
  expect(view.commands).toHaveBeenCalledTimes(2);
});

it.each([
  [
    'is gone',
    new ApiError({ status: 404, code: 'NOT_FOUND', message: 'Not found' }),
  ],
  ['cannot be reached', new TypeError('Network request failed')],
])(
  'should show the analysis state as unknown with Retry and the run link when the latest run %s',
  async (_case, failure) => {
    const view = await openRecord({
      latestRunId: runId,
      analysisFreshness: 'unanalyzed',
    });
    const reads = view.reads.getMockImplementation();
    let unreadable = true;
    view.reads.mockImplementation(async (path, ...rest) => {
      if (path === `/v1/analyses/${runId}` && unreadable) {
        throw failure;
      }

      return reads?.(path, ...rest);
    });
    await view.client.resetQueries({ queryKey: ['analysis', runId] });

    await waitFor(() =>
      expect(screen.getByTestId('record-analysis-status-unknown')).toBeTruthy(),
    );
    expect(screen.getByTestId('record-analysis-badge')).toHaveTextContent(
      'Analysis status unavailable',
    );
    expect(
      screen.getByText(
        'The latest analysis could not be loaded. Retry, or open it.',
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId('record-analyse')).toBeNull();
    await fireEvent.press(screen.getByTestId('record-open-run'));
    expect(view.router.push).toHaveBeenCalledWith(`/analysis/${runId}`);

    unreadable = false;
    await fireEvent.press(screen.getByTestId('record-analysis-retry'));

    await waitFor(() =>
      expect(
        screen.getByTestId('record-analysis-status-analysed'),
      ).toBeTruthy(),
    );
  },
);
