import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import {
  actionId,
  actionableRun,
  openAnalysisDetails,
  withFinishedJob,
} from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

const applyAttempts = 3;

jest.mock(
  '../../../providers/AuthProvider',
  () =>
    ({
      useAuth:
        jest.fn<typeof import('../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock(
  'expo-crypto',
  () =>
    ({
      randomUUID:
        jest.requireActual<typeof import('node:crypto')>('node:crypto')
          .randomUUID,
    }) satisfies Partial<typeof import('expo-crypto')>,
);
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

it.each([
  { button: 'Evidence supplied', status: 'supplied' },
  { button: 'Dismiss action', status: 'dismissed' },
])(
  'should preserve a collector reason after failed $status resolution and apply it on retry',
  async ({ button, status }) => {
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : collectionRecord,
      ),
    });
    await openAnalysisDetails();

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
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? suggested : collectionRecord,
    ),
    post: async () => ({ id: checkId }),
  });
  await openAnalysisDetails();
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

it('should retry applying the same analysis selection and revision under the same key', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? actionableRun : collectionRecord,
    ),
    post: async () => {
      throw new TypeError('Network request failed');
    },
  });
  const changes = actionableRun.result.output!.proposedChanges;
  const proposal = await screen.findByTestId(
    `analysis-proposal-${changes[0].id}`,
  );
  await waitFor(() => expect(proposal).toBeEnabled());
  await fireEvent.press(proposal);

  await fireEvent.press(screen.getByTestId('analysis-apply'));
  await waitFor(() =>
    expect(screen.getByTestId('analysis-apply')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('analysis-apply'));
  await waitFor(() =>
    expect(screen.getByTestId('analysis-apply')).toBeEnabled(),
  );

  expect(view.commands).toHaveBeenCalledTimes(2);
  const [first, retry] = view.commands.mock.calls.map(
    ([, , options]) => options,
  );
  expect(first.idempotencyKey).toEqual(expect.any(String));
  expect(retry).toEqual(first);
  expect(view.router.replace).not.toHaveBeenCalled();
});

it.each(['selection', 'revision'] as const)(
  'should start a new stable analysis apply key when the %s changes',
  async (changed) => {
    let record = { ...collectionRecord };
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? actionableRun : record,
      ),
      post: async () => {
        throw new TypeError('Network request failed');
      },
    });
    const changes = actionableRun.result.output!.proposedChanges;
    const proposal = await screen.findByTestId(
      `analysis-proposal-${changes[0].id}`,
    );
    await waitFor(() => expect(proposal).toBeEnabled());
    await fireEvent.press(proposal);
    if (changed === 'revision') {
      record = { ...record, recordRevision: 2 };
      view.commands.mockRejectedValueOnce(
        Object.assign(new Error('Record changed elsewhere'), { status: 409 }),
      );
    }
    await fireEvent.press(screen.getByTestId('analysis-apply'));
    await waitFor(() =>
      expect(screen.getByTestId('analysis-apply')).toBeEnabled(),
    );

    if (changed === 'selection') {
      await fireEvent.press(
        screen.getByTestId(`analysis-proposal-${changes[1].id}`),
      );
    }
    await fireEvent.press(screen.getByTestId('analysis-apply'));
    await waitFor(() =>
      expect(screen.getByTestId('analysis-apply')).toBeEnabled(),
    );
    await fireEvent.press(screen.getByTestId('analysis-apply'));
    await waitFor(() =>
      expect(screen.getByTestId('analysis-apply')).toBeEnabled(),
    );

    expect(view.commands).toHaveBeenCalledTimes(applyAttempts);
    const [first, changedRequest, retry] = view.commands.mock.calls.map(
      ([, , options]) => options,
    );
    expect(changedRequest.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(changedRequest.body).toEqual({
      expectedRecordRevision: changed === 'revision' ? 2 : 1,
      selectedProposalIds:
        changed === 'selection'
          ? changes.map((change) => change.id)
          : [changes[0].id],
    });
    expect(retry).toEqual(changedRequest);
  },
);
