import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { ApiError } from '@antica/client';
import { analysisRunDetailSchema } from '@antica/contracts';

import {
  collectionRecord,
  renderMobile,
  savedLanguage,
} from '../../../mobile.spec.fixtures';
import {
  runId,
  firstProposalId,
  run,
  secondProposalId,
} from '../../../saved-analysis.spec.fixtures';

import { conflictStatus, withFinishedJob } from './analysis.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

it('should apply only proposals the collector leaves selected', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? run : collectionRecord,
    ),
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeEnabled());
  expect(view.commands).not.toHaveBeenCalled();
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  await fireEvent.press(screen.getAllByRole('checkbox')[1]);
  await fireEvent.press(screen.getAllByRole('checkbox')[1]);
  await fireEvent.press(screen.getByRole('button', { name: 'Apply 1' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}/history`,
    ),
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

it('should apply an unchanged field after unrelated manual edits advance the input version', async () => {
  const currentRecord = {
    ...collectionRecord,
    recordRevision: 3,
    analysisInputVersion: run.snapshot.analysisInputVersion + 1,
    tags: ['manually edited'],
  };
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? run : currentRecord,
    ),
  });
  await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(2));
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  const apply = screen.getByRole('button', {
    name: 'Apply 1',
  });
  await waitFor(() => expect(apply).toBeEnabled());
  await fireEvent.press(apply);
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands).toHaveBeenCalledWith(
    `/v1/analyses/${runId}/apply`,
    expect.anything(),
    expect.objectContaining({
      body: {
        expectedRecordRevision: 3,
        selectedProposalIds: [firstProposalId],
      },
    }),
  );
});

it('should preserve selection after a stale write and retry against the refreshed revision', async () => {
  const currentRecord = {
    ...collectionRecord,
    analysisInputVersion: run.snapshot.analysisInputVersion + 1,
  };
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? run : currentRecord,
    ),
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
    ...currentRecord,
    recordRevision: 2,
  });
  await fireEvent.press(screen.getAllByRole('checkbox')[0]);
  await fireEvent.press(screen.getByRole('button', { name: 'Apply 1' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Review the latest revision/,
    ),
  );
  expect(screen.getAllByRole('checkbox')[0]).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: 'Apply 1' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}/history`,
    ),
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
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? actionable : collectionRecord,
      ),
    });
    await fireEvent.press(await screen.findByTestId('analysis-details-toggle'));
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
  await renderMobile(
    <AnalysisContainer runId={runId} />,
    {
      get: withFinishedJob(async (path) =>
        path.startsWith('/v1/analyses/') ? localized : collectionRecord,
      ),
    },
    savedLanguage('zh-Hant'),
  );
  await waitFor(() =>
    expect(screen.getByRole('checkbox', { name: '套用名稱建議' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByTestId('analysis-details-toggle'));
  expect(screen.getByText('直接觀察 · 支持')).toBeTruthy();
  expect(screen.getByText('Visible wear')).toBeTruthy();
});

it('should mark a proposal stale and refuse its tick once its field changed since', async () => {
  const edited = {
    ...collectionRecord,
    name: 'Collector name',
    latestRunId: runId,
  };
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? run : edited,
    ),
  });

  expect(
    await screen.findByTestId(
      `analysis-suggestion-state-stale-${firstProposalId}`,
    ),
  ).toBeTruthy();
  const stale = screen.getByTestId(`analysis-proposal-${firstProposalId}`);
  expect(stale).toBeDisabled();
  await waitFor(() =>
    expect(screen.getByTestId('record-segment-suggestions')).toHaveTextContent(
      'Suggestions2',
    ),
  );
  await fireEvent.press(stale);
  expect(stale).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Apply 0' })).toBeDisabled();
  expect(view.commands).not.toHaveBeenCalled();
});

it('should list a stale proposal after the ones that can still be applied', async () => {
  const edited = { ...collectionRecord, name: 'Collector name' };
  await renderMobile(<AnalysisContainer runId={runId} />, {
    get: withFinishedJob(async (path) =>
      path.startsWith('/v1/analyses/') ? run : edited,
    ),
  });

  await screen.findByTestId(
    `analysis-suggestion-state-stale-${firstProposalId}`,
  );
  const cards = screen
    .getAllByTestId(/^analysis-suggestion-[0-9a-f]{8}-[0-9a-f-]{27}$/u)
    .map((card) => card.props.testID as string);
  expect(cards).toEqual([
    `analysis-suggestion-${secondProposalId}`,
    `analysis-suggestion-${firstProposalId}`,
  ]);
});
