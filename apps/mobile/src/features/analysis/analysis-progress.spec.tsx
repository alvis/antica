import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { run, runId } from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should poll a queued analysis until partial results arrive and offer adding evidence', async () => {
  let reads = 0;
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) => {
      if (!path.startsWith('/v1/analyses/')) {
        return collectionRecord;
      }
      reads += 1;

      return reads === 1
        ? { ...run, status: 'queued', result: { ...run.result, output: null } }
        : { ...run, status: 'partial' };
    },
  });
  await waitFor(() => expect(screen.getByText('Processing')).toBeTruthy());
  await waitFor(
    () =>
      expect(
        screen.getByText('Two suggestions require collector approval.'),
      ).toBeTruthy(),
    { timeout: 10000 },
  );
  expect(screen.getByText('Partially complete')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}`,
  );
});

it('should retry a failed analysis read', async () => {
  let failed = true;
  await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) => {
      if (!path.startsWith('/v1/analyses/')) {
        return collectionRecord;
      }
      if (failed) {
        failed = false;
        throw new Error('Analysis connection lost');
      }

      return run;
    },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Analysis connection lost',
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(
      screen.getByText('Two suggestions require collector approval.'),
    ).toBeTruthy(),
  );
});

it('should deselect a proposal and preserve the remaining selection after a non-conflict failure', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? run : collectionRecord,
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  const choices = screen.getAllByRole('checkbox');
  await fireEvent.press(choices[0]);
  await fireEvent.press(choices[1]);
  await fireEvent.press(choices[0]);
  expect(choices[0]).not.toBeChecked();
  expect(choices[1]).toBeChecked();
  view.commands.mockRejectedValueOnce(new Error('Apply connection lost'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Apply connection lost',
    ),
  );
  expect(screen.getAllByRole('checkbox')[1]).toBeChecked();
});
