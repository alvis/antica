import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ScrollView } from 'react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import {
  firstProposalId,
  run,
  runId,
  secondProposalId,
} from '../../../saved-analysis.spec.fixtures';

import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const historyKey = ['record', collectionRecord.id, 'history'];
const rowY = 200;
const sectionY = 900;
const contentGap = 24;
const reads = async (path: string): Promise<unknown> =>
  path.startsWith('/v1/analyses/') ? run : collectionRecord;

/**
 * lays out an element as the native renderer would
 * @param testID automation identifier of the element
 * @param y vertical offset inside its parent
 */
async function layOut(testID: string, y: number): Promise<void> {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y, width: 320, height: 120 } },
  });
}

it('should leave every proposal unselected on first render', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: reads,
  });

  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).not.toBeChecked();
  }
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply selected changes (0)' }),
    ).toBeDisabled(),
  );
  expect(view.commands).not.toHaveBeenCalled();
});

it('should open the record the analysis belongs to', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: reads,
  });

  await fireEvent.press(await screen.findByTestId('analysis-open-record'));

  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}`,
  );
});

it('should confirm an apply, refresh the record history, and link to it', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: reads,
  });
  view.client.setQueryData(historyKey, { pages: [], pageParams: [] });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  expect(screen.queryByTestId('analysis-applied-history')).toBeNull();

  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply selected changes (1)' }),
    ).toBeEnabled(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Applied to the record. The change is in its history.',
  );
  expect(view.client.getQueryState(historyKey)?.isInvalidated).toBe(true);
  await fireEvent.press(screen.getByTestId('analysis-applied-history'));
  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}/history`,
  );
});

it('should mark and scroll to the proposal opened from the change history without selecting it', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await renderMobile(
    <AnalysisContainer runId={runId} proposalId={secondProposalId} />,
    { get: reads },
  );
  const focused = await screen.findByTestId(
    `analysis-proposal-${secondProposalId}`,
  );

  // a selected state would read as a preselection, so the marker is only a hint
  const state = focused.props.accessibilityState as Record<string, unknown>;
  expect(state.selected).toBeUndefined();
  expect(focused).not.toBeSelected();
  expect(focused.props.accessibilityHint).toBe('Opened from change history');
  expect(focused).not.toBeChecked();
  expect(screen.getByText('Opened from change history')).toBeTruthy();
  const other = screen.getByTestId(`analysis-proposal-${firstProposalId}`);
  expect(other.props.accessibilityHint).toBeUndefined();

  await layOut(`analysis-proposal-${secondProposalId}`, rowY);
  expect(scrollTo).not.toHaveBeenCalled();
  await layOut('analysis-proposals', sectionY);
  await layOut('analysis-proposals', sectionY + rowY);
  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({
      y: sectionY + rowY - contentGap,
      animated: false,
    }),
  );
  expect(scrollTo).toHaveBeenCalledTimes(1);
});

it('should scroll to the top when the focused proposal sits above the content gap', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  await renderMobile(
    <AnalysisContainer runId={runId} proposalId={firstProposalId} />,
    { get: reads },
  );
  await screen.findByTestId(`analysis-proposal-${firstProposalId}`);

  await layOut('analysis-proposals', 0);
  await layOut(`analysis-proposal-${firstProposalId}`, 0);

  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false }),
  );
});

it('should wait for the record before scrolling, because its arrival moves the proposals', async () => {
  const scrollTo = jest.spyOn(ScrollView.prototype, 'scrollTo');
  let finishRecord: () => void = () => undefined;
  await renderMobile(
    <AnalysisContainer runId={runId} proposalId={secondProposalId} />,
    {
      get: async (path) =>
        path.startsWith('/v1/analyses/')
          ? run
          : new Promise((resolve) => {
              finishRecord = () => resolve(collectionRecord);
            }),
    },
  );
  await screen.findByTestId(`analysis-proposal-${secondProposalId}`);

  await layOut('analysis-proposals', sectionY);
  await layOut(`analysis-proposal-${secondProposalId}`, rowY);
  expect(scrollTo).not.toHaveBeenCalled();
  await act(async () => finishRecord());

  await waitFor(() =>
    expect(scrollTo).toHaveBeenCalledWith({
      y: sectionY + rowY - contentGap,
      animated: false,
    }),
  );
});
