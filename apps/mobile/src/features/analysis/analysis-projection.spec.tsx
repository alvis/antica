import { expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import {
  actionableRun,
  firstProposalId,
  runId,
} from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it.each(['accepted', 'skipped'] as const)(
  'should retain proposal evidence and uncertainties while preventing edits to a %s proposal',
  async (status) => {
    const projected = analysisRunDetailSchema.parse({
      ...actionableRun,
      result: {
        ...actionableRun.result,
        actionStates: [],
        proposalStates: [
          { proposalId: firstProposalId, status, latestAdoptionEventId: null },
        ],
        output: {
          ...actionableRun.result.output,
          uncertainties: ['The date remains uncertain'],
          findings: [
            {
              id: runId,
              kind: 'collectorObservation',
              text: 'The base has a repaired chip',
              evidenceIds: [],
              observationIds: [],
              citationIds: [],
              relation: 'context',
              certainty: 'reported',
            },
          ],
          proposedChanges: [
            {
              ...actionableRun.result.output!.proposedChanges[0],
              findingIds: [runId],
            },
          ],
          nextActions: actionableRun.result.output!.nextActions.map(
            (action) => ({ ...action, checkId: runId }),
          ),
        },
      },
    });
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: async (path) =>
        path.startsWith('/v1/analyses/') ? projected : collectionRecord,
    });
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled());
    expect(
      within(screen.getByRole('checkbox')).getByText(
        'The base has a repaired chip',
      ),
    ).toBeTruthy();
    expect(screen.getByText('The date remains uncertain')).toBeTruthy();
    expect(screen.queryByLabelText('Reason')).toBeNull();
    await fireEvent.press(screen.getByRole('checkbox'));
    expect(
      screen.getByRole('button', { name: 'Apply selected changes (0)' }),
    ).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Checks' }));
    expect(view.router.push).toHaveBeenCalledWith(`/checks/${runId}`);
    expect(view.commands).not.toHaveBeenCalled();
  },
);
