import { expect, it, jest } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import AnalysisRoute from '../../../app/(private)/analysis/[runId]';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { run, runId } from '../../../saved-analysis.spec.fixtures';

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
      useLocalSearchParams:
        jest.fn<typeof import('expo-router').useLocalSearchParams>(),
    }) satisfies Partial<typeof import('expo-router')>,
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);

jest.mocked(useLocalSearchParams).mockReturnValue({ runId });

it('should show the saved result selected by the analysis route', async () => {
  const view = await renderMobile(<AnalysisRoute />, {
    get: async (path) =>
      path === `/v1/analyses/${runId}` ? run : collectionRecord,
  });

  await waitFor(() =>
    expect(
      screen.getByText('Two suggestions require collector approval.'),
    ).toBeTruthy(),
  );
  expect(view.reads.mock.calls.map(([path]) => path)).toContain(
    `/v1/analyses/${runId}`,
  );
  view.client.clear();
});
