import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import {
  actionableRun,
  openAnalysisDetails,
  withFinishedJob,
} from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should defer creating a suggested check until the record is available', async () => {
  const pending = Promise.withResolvers<typeof collectionRecord>();
  const suggested = {
    ...actionableRun,
    suggestedMethods: [
      {
        methodId: runId,
        methodVersionId: runId,
        owningEntryId: runId,
        titleZhHant: 'Inspect the base',
      },
    ],
  };
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? suggested : pending.promise,
    ),
  });
  await openAnalysisDetails();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start check' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start check' }));
  expect(view.commands).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
  await act(async () => pending.resolve(collectionRecord));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Evidence supplied' }),
    ).toBeEnabled(),
  );
});

it('should prevent adoption and action resolution until the record is loaded', async () => {
  const pending = Promise.withResolvers<typeof collectionRecord>();
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? actionableRun : pending.promise,
    ),
  });
  await openAnalysisDetails();
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  // without the record a tick could rest on a stale field, so it is locked
  expect(screen.getAllByRole('checkbox')[0]).toBeDisabled();
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked();
  for (const label of ['Apply 0', 'Evidence supplied', 'Dismiss action']) {
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: label }));
  }
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
  await act(async () => pending.resolve(collectionRecord));
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Evidence supplied' }),
    ).toBeEnabled(),
  );
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  expect(screen.getByRole('button', { name: 'Apply 1' })).toBeEnabled();
});

it.each(['apply', 'resolve'])(
  'should disable duplicate analysis commands while %s is pending',
  async (phase) => {
    const pending = Promise.withResolvers<unknown>();
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : collectionRecord,
      ),
    });
    await openAnalysisDetails();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Evidence supplied' }),
      ).toBeEnabled(),
    );
    await fireEvent.press(screen.getAllByRole('checkbox')[0]);
    await fireEvent.changeText(
      screen.getByLabelText('Reason'),
      'Base inspected',
    );
    const command = phase === 'apply' ? view.commands : view.patches;
    command.mockReturnValueOnce(pending.promise);
    const label = phase === 'apply' ? 'Apply 1' : 'Evidence supplied';
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('button', { name: label })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(command).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(collectionRecord));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Evidence supplied' }),
      ).toBeEnabled(),
    );
  },
);

it('should disable a stale size suggestion and leave a current neighbour unselected and available', async () => {
  const staleId = '00000000-0000-4000-8000-000000000099';
  const proposed = {
    ...actionableRun,
    result: {
      ...actionableRun.result,
      output: {
        ...actionableRun.result.output!,
        proposedChanges: [
          {
            id: staleId,
            field: 'dimensions',
            before: {},
            proposed: { diameter: { value: 21.5, unit: 'cm' } },
            confidence: 'medium',
            findingIds: [],
          },
          {
            id: '00000000-0000-4000-8000-000000000098',
            field: 'name',
            before: collectionRecord.name,
            proposed: 'Suggested dish',
            confidence: 'high',
            findingIds: [],
          },
        ],
      },
    },
  };
  const record = {
    ...collectionRecord,
    dimensions: { diameter: { value: 21.8, unit: 'cm' } },
  };
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? proposed : record,
    ),
  });
  await waitFor(() =>
    expect(screen.getByTestId(`analysis-proposal-${staleId}`)).toBeDisabled(),
  );
  const current = screen.getByTestId(
    'analysis-proposal-00000000-0000-4000-8000-000000000098',
  );
  expect(current).not.toBeChecked();
  expect(screen.getByText(/Out of date/)).toBeTruthy();
  await fireEvent.press(screen.getByTestId(`analysis-proposal-${staleId}`));
  expect(view.commands).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Apply 0' })).toBeDisabled();
  await fireEvent.press(current);
  expect(screen.getByRole('button', { name: 'Apply 1' })).toBeEnabled();
});

it.each([false, true])(
  'should report a selected row that becomes stale and apply only current rows (neighbour selected: %s)',
  async (selectNeighbour) => {
    let record = { ...collectionRecord };
    const changes = actionableRun.result.output!.proposedChanges;
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : record,
      ),
      post: async () => record,
    });
    const name = await screen.findByTestId(
      `analysis-proposal-${changes[0].id}`,
    );
    await fireEvent.press(name);
    if (selectNeighbour) {
      await fireEvent.press(
        screen.getByTestId(`analysis-proposal-${changes[1].id}`),
      );
    }
    record = { ...record, name: 'Saved elsewhere', recordRevision: 2 };
    await act(async () => {
      await view.client.invalidateQueries({ queryKey: ['record', record.id] });
    });

    expect(
      await screen.findByTestId('analysis-selection-conflict'),
    ).toHaveTextContent(/Name/);
    expect(name).toBeDisabled();
    const apply = screen.getByTestId('analysis-apply');
    expect(apply).toHaveAccessibleName(selectNeighbour ? 'Apply 1' : 'Apply 0');
    if (selectNeighbour) {
      expect(apply).toBeEnabled();
      await fireEvent.press(apply);
      await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
      expect(view.commands.mock.calls[0][2].body).toMatchObject({
        expectedRecordRevision: 2,
        selectedProposalIds: [changes[1].id],
      });
    } else {
      expect(apply).toBeDisabled();
      await fireEvent.press(apply);
      expect(view.commands).not.toHaveBeenCalled();
      expect(view.router.replace).not.toHaveBeenCalled();
    }
  },
);
