import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { actionId, actionableRun, runId } from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

it.each([
  { button: 'Evidence supplied', status: 'supplied' },
  { button: 'Dismiss action', status: 'dismissed' },
])(
  'should preserve a collector reason after failed $status resolution and apply it on retry',
  async ({ button, status }) => {
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : collectionRecord,
    });

    await waitFor(() =>
      expect(screen.getByRole('button', { name: button })).toBeEnabled(),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Reason'),
      '  Collector inspected the base  ',
    );
    view.patches.mockRejectedValueOnce(new Error('Resolution connection lost'));
    await fireEvent.press(screen.getByRole('button', { name: button }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Resolution connection lost',
      ),
    );
    expect(screen.getByLabelText('Reason')).toHaveDisplayValue(
      '  Collector inspected the base  ',
    );
    await fireEvent.press(screen.getByRole('button', { name: button }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: button })).toBeEnabled(),
    );
    const expectedBody = {
      status,
      expectedActionRevision: 1,
      expectedRecordRevision: 1,
      ...(status === 'supplied'
        ? { support: { onSiteDescription: 'Collector inspected the base' } }
        : { reason: 'Collector inspected the base' }),
    };
    expect(
      view.patches.mock.calls.map(([path, , options]) => ({
        path,
        body: options.body,
      })),
    ).toEqual([
      { path: `/v1/analyses/${runId}/actions/${actionId}`, body: expectedBody },
      { path: `/v1/analyses/${runId}/actions/${actionId}`, body: expectedBody },
    ]);
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('should navigate method instructions and retry a check without duplicating its request', async () => {
  const methodId = '00000000-0000-4000-8000-000000000080';
  const methodVersionId = '00000000-0000-4000-8000-000000000081';
  const owningEntryId = '00000000-0000-4000-8000-000000000082';
  const checkId = '00000000-0000-4000-8000-000000000083';
  const suggested = analysisRunDetailSchema.parse({
    ...actionableRun,
    suggestedMethods: [
      {
        methodId,
        methodVersionId,
        owningEntryId,
        titleZhHant: 'Inspect the base',
      },
    ],
  });
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? suggested : collectionRecord,
    post: async () => ({ id: checkId }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Start check' })).toBeTruthy(),
  );
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  await fireEvent.press(screen.getByRole('button', { name: 'View method' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/knowledge/${owningEntryId}?methodVersionId=${methodVersionId}`,
  );
  view.commands.mockRejectedValueOnce(new Error('Check connection lost'));
  await fireEvent.press(screen.getByRole('button', { name: 'Start check' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Check connection lost',
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Start check' }));
  await waitFor(() =>
    expect(view.router.push).toHaveBeenCalledWith(`/checks/${checkId}`),
  );
  expect(view.commands.mock.calls[1]?.[2]).toEqual(
    view.commands.mock.calls[0]?.[2],
  );
  expect(view.commands.mock.calls[1]?.[2]?.body).toEqual({
    expectedRecordRevision: 1,
    methodId,
    methodVersionId,
    suggestedByRunId: runId,
  });
});
