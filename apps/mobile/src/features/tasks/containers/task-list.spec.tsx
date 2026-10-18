import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import TasksRoute from '../../../app/(private)/(tabs)/tasks';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const checkId = '00000000-0000-4000-8000-000000000021';
const runId = '00000000-0000-4000-8000-000000000022';
const actionId = '00000000-0000-4000-8000-000000000023';

it('should open a pending check and analysis action from the task list', async () => {
  const view = await renderMobile(<TasksRoute />, {
    get: async () => ({
      items: [
        {
          kind: 'recordCheck',
          recordId: collectionRecord.id,
          check: {
            id: checkId,
            revision: 1,
            createdAt: collectionRecord.createdAt,
            updatedAt: collectionRecord.updatedAt,
            recordId: collectionRecord.id,
            componentIds: [],
            methodId: checkId,
            methodVersionId: checkId,
            suggestedByRunId: null,
            progress: 'not_started',
            result: { kind: 'unrecorded' },
            observationIds: [],
            evidenceAnchorIds: [],
            pendingActionIds: [],
          },
        },
        {
          kind: 'analysisAction',
          recordId: collectionRecord.id,
          runId,
          action: {
            id: actionId,
            kind: 'describe',
            instruction: 'Inspect the base',
            reason: 'The base is hidden',
          },
          state: {
            runId,
            actionId,
            recordId: collectionRecord.id,
            revision: 1,
            status: 'pending',
            latestResolutionId: null,
            updatedAt: collectionRecord.updatedAt,
          },
          latestResolution: null,
        },
      ],
      nextCursor: null,
    }),
  });

  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(2),
  );
  expect(screen.getByText('Not checked')).toBeTruthy();
  expect(screen.getByText('Inspect the base')).toBeTruthy();
  await fireEvent.press(screen.getAllByRole('button', { name: 'View' })[0]);
  await fireEvent.press(screen.getAllByRole('button', { name: 'View' })[1]);

  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/checks/${checkId}`],
    [`/analysis/${runId}`],
  ]);
});

it('should show empty task state and retry a failed request', async () => {
  const view = await renderMobile(<TasksRoute />, {
    get: jest
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('Offline'))
      .mockResolvedValue({ items: [], nextCursor: null }),
  });

  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByText('Nothing here yet.')).toBeTruthy(),
  );
  expect(view.reads).toHaveBeenCalledWith(
    '/v1/tasks?limit=50',
    expect.anything(),
    expect.anything(),
  );
});
