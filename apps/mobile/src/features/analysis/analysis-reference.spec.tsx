import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { Linking } from 'react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';
import { runId, createReferencedRun } from '../../saved-analysis.spec.fixtures';

import { media } from '../media/media.spec.fixtures';

import { AnalysisContainer } from './AnalysisContainer';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const mixed = createReferencedRun(media.asset.id);

it.each(['Evidence 10000000', 'Citation 30000000'])(
  'should report unavailable %s without inventing a navigation target',
  async (label) => {
    const view = await renderMobile(<AnalysisContainer runId={runId} />, {
      get: async (path) =>
        path.startsWith('/v1/analyses/')
          ? { ...mixed, citations: [] }
          : path.startsWith('/v1/media/')
            ? media
            : collectionRecord,
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: label })).toBeTruthy(),
    );
    await waitFor(() => expect(view.client.isFetching()).toBe(0));
    await fireEvent.press(screen.getByRole('button', { name: label }));
    expect(screen.getByRole('alert')).toHaveTextContent('Source needs review');
    expect(view.router.push).not.toHaveBeenCalled();
  },
);

it('should open the exact retrieved web citation URL', async () => {
  const url = 'https://museum.example/item?id=ceramic#provenance';
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const webRun = analysisRunDetailSchema.parse({
    ...mixed,
    citations: mixed.citations.map((citation) => ({
      ...citation,
      locator: {
        kind: 'web',
        sourceId: citation.locator.sourceId,
        sourceVersionId: citation.locator.sourceVersionId,
        url,
        retrievedAt: collectionRecord.createdAt,
        snapshotAssetId: null,
        blockId: null,
        excerptAsRetrieved: null,
      },
    })),
  });
  await renderMobile(<AnalysisContainer runId={runId} />, {
    get: async (path) =>
      path.startsWith('/v1/analyses/')
        ? webRun
        : path.startsWith('/v1/media/')
          ? media
          : collectionRecord,
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Citation 30000000' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Citation 30000000' }),
  );
  expect(open).toHaveBeenCalledWith(url);
});
