import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { collectionRecord } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { newRunId, openRecord } from './record-analysis.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
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

it('should show a just-saved record as saved and not yet analysed with an Analyse action (B06)', async () => {
  await openRecord({ latestRunId: null, analysisFreshness: 'unanalyzed' });

  await waitFor(() =>
    expect(
      screen.getByTestId('record-analysis-status-unanalysed'),
    ).toBeTruthy(),
  );
  expect(
    screen.getByText('Saved. You can start an analysis at any time.'),
  ).toBeTruthy();
  expect(screen.getByTestId('record-analyse')).toHaveTextContent(
    'Start analysis',
  );
  expect(screen.getByTestId('record-analyse')).toHaveProp(
    'accessibilityState',
    { disabled: false },
  );
  expect(screen.queryByTestId('record-open-run')).toBeNull();
});

it('should start one analysis for repeated presses and open its conversation', async () => {
  const view = await openRecord({
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
    recordRevision: 4,
  });
  const accepted = Promise.withResolvers<unknown>();
  view.commands.mockReturnValueOnce(accepted.promise);
  await waitFor(() =>
    expect(screen.getByTestId('record-analyse')).toBeTruthy(),
  );

  await act(async () => {
    void fireEvent.press(screen.getByTestId('record-analyse'));
    void fireEvent.press(screen.getByTestId('record-analyse'));
  });
  expect(screen.getByTestId('record-analyse')).toHaveProp(
    'accessibilityState',
    { busy: true, disabled: true },
  );
  await act(async () => accepted.resolve({ runId: newRunId, jobId: newRunId }));

  expect(view.commands).toHaveBeenCalledTimes(1);
  expect(view.commands.mock.calls[0]).toEqual([
    `/v1/records/${collectionRecord.id}/analyses`,
    expect.anything(),
    expect.objectContaining({ body: { expectedRecordRevision: 4 } }),
  ]);
  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}/messages?startedRunId=${newRunId}`,
  );
});

it('should offer no analysis for a record without evidence', async () => {
  await openRecord({
    latestRunId: null,
    analysisFreshness: 'unanalyzed',
    mediaIds: [],
  });

  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Start analysis' }),
    ).toBeDisabled(),
  );
});

it.each([
  { status: 'queued' as const, badge: 'Analyzing' },
  { status: 'running' as const, badge: 'Analyzing' },
])(
  'should show a $status run as analysing with a link instead of another start',
  async ({ status, badge }) => {
    const view = await openRecord(
      { latestRunId: runId, analysisFreshness: 'unanalyzed' },
      status,
    );

    await waitFor(() =>
      expect(screen.getByTestId('record-analysis-running')).toHaveTextContent(
        badge,
      ),
    );
    expect(screen.getByTestId('record-analysis-running')).toHaveProp(
      'accessibilityState',
      { busy: true, disabled: true },
    );
    expect(screen.getByTestId('record-analysis-status-running')).toBeTruthy();
    expect(screen.queryByTestId('record-analyse')).toBeNull();
    // the run stays one tap away under 建議
    await fireEvent.press(screen.getByRole('link', { name: 'Suggestions' }));
    expect(view.router.push).toHaveBeenCalledWith(`/analysis/${runId}`);
  },
);

it.each([
  { status: 'completed' as const, state: 'analysed' },
  { status: 'partial' as const, state: 'partial' },
])(
  'should show a $status run of the current input as $state without a new start',
  async ({ status, state }) => {
    await openRecord(
      { latestRunId: runId, analysisFreshness: 'current' },
      status,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId(`record-analysis-status-${state}`),
      ).toBeTruthy(),
    );
    // the line under the run's link says when it finished
    await waitFor(() => expect(screen.getByText(/^Analysed /)).toBeTruthy());
    expect(screen.queryByTestId('record-analyse')).toBeNull();
    expect(screen.getByTestId('record-open-run')).toHaveTextContent(
      'View analysis',
    );
  },
);

it('should offer Analyse again after a failed run', async () => {
  await openRecord(
    { latestRunId: runId, analysisFreshness: 'unanalyzed' },
    'failed',
  );

  await waitFor(() =>
    expect(screen.getByTestId('record-analysis-status-failed')).toBeTruthy(),
  );
  expect(screen.getByTestId('record-analyse')).toHaveTextContent(
    'Analyze again',
  );
});

it('should show new evidence after a run as not yet analysed and never start one by itself (C05)', async () => {
  const view = await openRecord({
    latestRunId: runId,
    analysisFreshness: 'outdated',
  });

  await waitFor(() =>
    expect(screen.getByTestId('record-analysis-status-outdated')).toBeTruthy(),
  );
  expect(
    screen.getByText(
      'New evidence was added after the last analysis. Uploading never starts an analysis.',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('record-analyse')).toHaveTextContent(
    'Analyze again',
  );
  expect(view.commands).not.toHaveBeenCalled();
});
