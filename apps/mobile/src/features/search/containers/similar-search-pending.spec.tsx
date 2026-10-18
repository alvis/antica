import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import {
  imageComparisonSchema,
  imageSearchResultSchema,
} from '@antica/contracts';

import SimilarRoute from '../../../app/(private)/research/similar';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

import type { useLocalSearchParams, useRouter } from 'expo-router';

import type {
  MobileHarness,
  MobileResponses,
} from '../../../mobile.spec.fixtures';
import type { useAuth } from '../../../providers/AuthProvider';

jest.mock(
  '../../../providers/AuthProvider',
  () =>
    ({
      useAuth: jest.fn<typeof useAuth>(),
    }) satisfies Partial<typeof import('../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof useRouter>(),
      useLocalSearchParams: jest.fn<typeof useLocalSearchParams>(
        () =>
          ({
            anchorId: '00000000-0000-4000-8000-000000000090',
            recordId: '00000000-0000-4000-8000-000000000001',
          }) satisfies ReturnType<typeof useLocalSearchParams>,
      ) as typeof useLocalSearchParams,
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

const anchorId = '00000000-0000-4000-8000-000000000090';
const sourceId = '00000000-0000-4000-8000-000000000091';
const pageId = '00000000-0000-4000-8000-000000000092';
const imageId = '00000000-0000-4000-8000-000000000093';
const locator = {
  kind: 'page' as const,
  sourceId,
  sourceVersionId: sourceId,
  pageId,
  pageIndex: 1,
  printedPageLabel: '2',
  canonicalViewId: pageId,
  regionId: null,
  region: null,
  textRange: null,
};
const firstMatch = {
  ref: {
    kind: 'reference' as const,
    sourceVersionId: sourceId,
    referenceImageId: imageId,
  },
  rank: 1,
  matchingRegions: [],
  thumbnail: null,
  sourceLocator: locator,
  sourceTitle: 'Catalog plate',
  contributorNames: ['Scholar'],
  warningsZhHant: [],
};
const secondMatch = {
  ...firstMatch,
  ref: {
    ...firstMatch.ref,
    referenceImageId: '00000000-0000-4000-8000-000000000097',
  },
  rank: 2,
  sourceTitle: 'Second catalog plate',
};
const firstComparison = imageComparisonSchema.parse({
  comparisonId: '00000000-0000-4000-8000-000000000094',
  queryAnchorId: anchorId,
  selected: firstMatch.ref,
  selectedRegion: null,
  selectedCanonicalViewId: null,
  similaritiesZhHant: ['Matching silhouette'],
  differencesZhHant: ['Different foot'],
  limitsZhHant: ['Photo angle differs'],
  citations: [],
});
const secondComparison = imageComparisonSchema.parse({
  ...firstComparison,
  comparisonId: '00000000-0000-4000-8000-000000000098',
  selected: secondMatch.ref,
  similaritiesZhHant: ['Matching rim'],
});
const pending = Promise.withResolvers<typeof firstComparison>();
const replies = [
  imageSearchResultSchema.parse({
    items: [firstMatch, secondMatch],
    nextCursor: null,
    queryAnchorId: anchorId,
    indexVersion: 'v1',
    availableScope: 'complete',
    warningsZhHant: [],
  }),
  pending.promise,
  secondComparison,
].values();
const responses = {
  get: async () => collectionRecord,
  post: async (path) =>
    path === '/v1/references' ? collectionRecord : replies.next().value,
} satisfies MobileResponses;

it('should preserve the pending comparison when another enabled Compare is pressed and save only the chosen result', async () => {
  const view = await renderMobile(<SimilarRoute />, responses);

  try {
    await exercisePendingComparison(view);
    await act(async () => {
      pending.resolve(firstComparison);
      await pending.promise;
    });
    await saveDisplayedComparison('Matching silhouette', 'Matching rim');
    expect(screen.getAllByRole('button', { name: 'Compare' })[1]).toBeEnabled();
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Compare' })[1],
    );
    await saveDisplayedComparison('Matching rim', 'Matching silhouette');
    expect(
      view.commands.mock.calls
        .filter(([path]) => path === '/v1/references')
        .map(([, , request]) => request.body),
    ).toEqual([
      expect.objectContaining({
        reference: { kind: 'source', locator, referenceImageId: imageId },
        comparisonId: firstComparison.comparisonId,
      }),
      expect.objectContaining({
        reference: {
          kind: 'source',
          locator,
          referenceImageId: secondMatch.ref.referenceImageId,
        },
        comparisonId: secondComparison.comparisonId,
      }),
    ]);
  } finally {
    await act(async () => {
      pending.resolve(firstComparison);
      await pending.promise;
    });
    await screen.unmount();
    view.client.clear();
  }
});

/**
 * exercises competing Compare presses through the rendered busy state
 * @param view native route's isolated transport boundary
 */
async function exercisePendingComparison(view: MobileHarness): Promise<void> {
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(secondMatch.sourceTitle)).toBeVisible();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Compare' })[0]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Processing' })).toBeDisabled(),
  );
  expect(screen.getAllByRole('button', { name: 'Compare' })[1]).toBeEnabled();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Compare' })[1]);

  expect(view.commands.mock.calls.map(([, , request]) => request.body)).toEqual(
    [
      expect.objectContaining({ mode: 'search' }),
      expect.objectContaining({
        mode: 'compare',
        queryAnchorId: anchorId,
        selected: firstMatch.ref,
      }),
    ],
  );
  expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull();
}

/**
 * saves the displayed comparison after verifying its identity and enabled action
 * @param expectedSummary response content that must be visible
 * @param absentSummary other response content that must be absent
 */
async function saveDisplayedComparison(
  expectedSummary: string,
  absentSummary: string,
): Promise<void> {
  expect(await screen.findByText(expectedSummary)).toBeVisible();
  expect(screen.queryByText(absentSummary)).toBeNull();
  expect(screen.getByRole('button', { name: 'Add reference' })).toBeEnabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull(),
  );
}
