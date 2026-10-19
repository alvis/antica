import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { actionableRun } from './analysis.spec.fixtures';
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
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? suggested : pending.promise,
  });
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
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? actionableRun : pending.promise,
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  for (const label of [
    'Apply selected changes (1)',
    'Evidence supplied',
    'Dismiss action',
  ]) {
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
});

it.each(['apply', 'resolve'])(
  'should disable duplicate analysis commands while %s is pending',
  async (phase) => {
    const pending = Promise.withResolvers<unknown>();
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : collectionRecord,
    });
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
    const label =
      phase === 'apply' ? 'Apply selected changes (1)' : 'Evidence supplied';
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
