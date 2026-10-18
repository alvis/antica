import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import {
  run,
  runId,
  evidenceId,
  observationId,
  pageId,
  sourceId,
  versionId,
  createReferencedRun,
} from '../../../saved-analysis.spec.fixtures';

import { media } from '../../media/containers/media.spec.fixtures';

import { supported } from './analysis-reference.spec.fixtures';
import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const mixed = createReferencedRun(media.asset.id);

it('should expose failed analysis recovery without automatically launching another run', async () => {
  const failed = analysisRunDetailSchema.parse({
    ...run,
    status: 'failed',
    result: { ...run.result, output: null },
  });
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? failed : collectionRecord,
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Analysis could not finish. Review this item and choose Analyze again when ready.',
    ),
  );
  expect(screen.queryByText('Processing')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Review item' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/collection/${collectionRecord.id}`,
  );
  expect(view.commands).not.toHaveBeenCalled();
});

it('should present hypotheses explicitly as pending research', async () => {
  const hypotheses = analysisRunDetailSchema.parse({
    ...run,
    result: {
      ...run.result,
      output: {
        ...run.result.output,
        findings: [
          {
            id: runId,
            kind: 'hypothesis',
            text: 'Possibly a later replacement foot',
            evidenceIds: [],
            observationIds: [],
            citationIds: [],
            relation: 'context',
            certainty: 'tentative',
          },
        ],
      },
    },
  });
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/') ? hypotheses : collectionRecord,
  });
  await waitFor(() =>
    expect(screen.getByText('Hypotheses pending research')).toBeTruthy(),
  );
  expect(screen.getByText('Possibly a later replacement foot')).toBeTruthy();
  expect(screen.getByText(/Tentative/)).toBeTruthy();
  expect(view.commands).not.toHaveBeenCalled();
});

it('should route mixed finding references by their individual reference kind', async () => {
  const view = await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/')
        ? mixed
        : path.startsWith('/v1/media/')
          ? supported
          : collectionRecord,
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Citation 30000000' }),
    ).toBeTruthy(),
  );
  await waitFor(() => expect(view.client.isFetching()).toBe(0));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Evidence 10000000' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Observation 20000000' }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Citation 30000000' }),
  );
  expect(
    jest.mocked(view.router.push).mock.calls.map(([path]) => path),
  ).toEqual([
    `/media/${media.asset.id}?anchorId=${evidenceId}`,
    `/collection/${collectionRecord.id}?observationId=${observationId}`,
    `/sources/${sourceId}?versionId=${versionId}&pageId=${pageId}`,
  ]);
});
