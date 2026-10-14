import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { getItemAsync } from 'expo-secure-store';

import { ApiError } from '@antica/client';
import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';
import {
  runId,
  firstProposalId,
  run,
} from '../../saved-analysis.spec.fixtures';

import { conflictStatus } from './analysis.spec.fixtures';
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

it('should apply only proposals the collector leaves selected', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? run : collectionRecord,
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  await fireEvent.press(screen.getAllByRole('checkbox')[1]);
  await fireEvent.press(screen.getAllByRole('checkbox')[1]);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply selected changes (0)' }),
    ).toBeTruthy(),
  );
  expect(
    view.commands.mock.calls.map(([path, , options]) => ({
      path,
      body: options.body,
    })),
  ).toEqual([
    {
      path: `/v1/analyses/${runId}/apply`,
      body: {
        expectedRecordRevision: 1,
        selectedProposalIds: [firstProposalId],
      },
    },
  ]);
});

it('should preserve selection after a stale write and retry against the refreshed revision', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? run : collectionRecord,
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  view.commands.mockRejectedValueOnce(
    new ApiError({
      status: conflictStatus,
      code: 'STALE_REVISION',
      message: 'Stale',
    }),
  );
  view.reads.mockResolvedValueOnce({
    ...collectionRecord,
    recordRevision: 2,
  });
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Review the latest revision/,
    ),
  );
  expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Apply selected changes (1)' }),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Apply selected changes (0)' }),
    ).toBeTruthy(),
  );
  expect(view.commands.mock.calls.map(([, , options]) => options.body)).toEqual(
    [
      { expectedRecordRevision: 1, selectedProposalIds: [firstProposalId] },
      { expectedRecordRevision: 2, selectedProposalIds: [firstProposalId] },
    ],
  );
});

it.each(['Evidence supplied', 'Dismiss action'])(
  'should require a reason before %s for an untouched action',
  async (label) => {
    const actionId = '00000000-0000-4000-8000-000000000013';
    const actionable = analysisRunDetailSchema.parse({
      ...run,
      result: {
        ...run.result,
        actionStates: [
          {
            runId,
            actionId,
            recordId: collectionRecord.id,
            revision: 1,
            status: 'pending',
            latestResolutionId: null,
            updatedAt: collectionRecord.updatedAt,
          },
        ],
        output: {
          ...run.result.output,
          nextActions: [
            {
              id: actionId,
              kind: 'describe',
              instruction: 'Describe the base',
              reason: 'The base is not visible',
            },
          ],
        },
      },
    });
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: async (path) =>
        path.startsWith('/v1/analyses/') ? actionable : collectionRecord,
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toBeEnabled(),
    );
    await fireEvent.press(screen.getByRole('button', { name: label }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Add a description or reason first.',
      ),
    );
    expect(view.commands).not.toHaveBeenCalled();
  },
);

it('should translate finding status and proposal labels while preserving source text', async () => {
  jest.mocked(getItemAsync).mockResolvedValueOnce('zh-Hant');
  const localized = analysisRunDetailSchema.parse({
    ...run,
    result: {
      ...run.result,
      output: {
        ...run.result.output,
        findings: [
          {
            id: '00000000-0000-4000-8000-000000000099',
            kind: 'visualObservation',
            text: 'Visible wear',
            evidenceIds: [],
            observationIds: [],
            citationIds: [],
            relation: 'supports',
            certainty: 'observed',
          },
        ],
      },
    },
  });
  await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? localized : collectionRecord,
  });
  await waitFor(() => expect(screen.getByText('直接觀察 · 支持')).toBeTruthy());
  expect(screen.getByText('Visible wear')).toBeTruthy();
  expect(screen.getByText(/名稱 · 待處理/)).toBeTruthy();
});
