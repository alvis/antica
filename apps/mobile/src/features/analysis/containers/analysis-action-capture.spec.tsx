import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { actionId, actionableRun } from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

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

const checkId = '00000000-0000-4000-8000-000000000033';

/**
 * builds the run with one action and its saved state
 * @param action action fields replacing the fixture's describe action
 * @param status saved action state
 * @returns a parsed run detail
 */
function runWith(
  action: Record<string, unknown>,
  status: 'pending' | 'supplied' | 'dismissed' = 'pending',
): ReturnType<typeof analysisRunDetailSchema.parse> {
  return analysisRunDetailSchema.parse({
    ...actionableRun,
    result: {
      ...actionableRun.result,
      actionStates: actionableRun.result.actionStates.map((state) => ({
        ...state,
        status,
      })),
      output: {
        ...actionableRun.result.output,
        nextActions: [
          { ...actionableRun.result.output!.nextActions[0], ...action },
        ],
      },
    },
  });
}

/**
 * renders the analysis screen for a run
 * @param run run returned for the analysis read
 * @returns the mobile harness
 */
async function openRun(
  run: ReturnType<typeof runWith>,
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? run : collectionRecord,
  });
  await waitFor(() =>
    expect(screen.getByTestId(`analysis-action-${actionId}`)).toBeTruthy(),
  );

  return view;
}

it('should open capture pre-linked to a photo action, its run, and its check (C04)', async () => {
  const view = await openRun(
    runWith({
      kind: 'capturePhoto',
      instruction: 'Photograph the entire base',
      checkId,
    }),
  );

  expect(
    screen.getByTestId(`analysis-action-status-pending-${actionId}`),
  ).toHaveTextContent('Needs evidence');
  const capture = screen.getByTestId(`analysis-action-capture-${actionId}`);
  const describe = screen.getByTestId(`analysis-action-describe-${actionId}`);
  // the photo answer leads for a photo action
  expect(capture).toHaveStyle({ backgroundColor: '#173D35' });
  expect(describe).toHaveStyle({ borderColor: '#173D35' });
  await fireEvent.press(capture);
  await fireEvent.press(describe);
  await fireEvent.press(
    screen.getByTestId(`analysis-action-check-${actionId}`),
  );

  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [
      `/capture?recordId=${collectionRecord.id}&runId=${runId}&actionId=${actionId}`,
    ],
    [
      `/capture?recordId=${collectionRecord.id}&runId=${runId}&actionId=${actionId}&mode=describe`,
    ],
    [`/checks/${checkId}`],
  ]);
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
});

it('should keep an action without a check actionable through unlinked capture (PT-13)', async () => {
  const view = await openRun(runWith({}));

  expect(screen.queryByTestId(`analysis-action-check-${actionId}`)).toBeNull();
  const describe = screen.getByTestId(`analysis-action-describe-${actionId}`);
  // words lead for a describe action
  expect(describe).toHaveStyle({ backgroundColor: '#173D35' });
  await fireEvent.press(describe);
  await fireEvent.press(
    screen.getByTestId(`analysis-action-capture-${actionId}`),
  );

  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [
      `/capture?recordId=${collectionRecord.id}&runId=${runId}&actionId=${actionId}&mode=describe`,
    ],
    [
      `/capture?recordId=${collectionRecord.id}&runId=${runId}&actionId=${actionId}`,
    ],
  ]);
});

it.each([
  { status: 'supplied' as const, label: 'Evidence supplied' },
  { status: 'dismissed' as const, label: 'Dismissed' },
])(
  'should reopen a $status action in its saved state without capture or resolution controls (PT-13)',
  async ({ status, label }) => {
    const view = await openRun(runWith({ checkId }, status));

    expect(
      screen.getByTestId(`analysis-action-status-${status}-${actionId}`),
    ).toHaveTextContent(label);
    expect(
      screen.queryByTestId(`analysis-action-capture-${actionId}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`analysis-action-describe-${actionId}`),
    ).toBeNull();
    expect(screen.queryByLabelText('Reason')).toBeNull();
    expect(
      screen.getByTestId(`analysis-action-check-${actionId}`),
    ).toBeTruthy();
    expect(view.commands).not.toHaveBeenCalled();
    expect(view.patches).not.toHaveBeenCalled();
  },
);
