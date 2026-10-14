import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import {
  evidenceAnchorSchema,
  imageSearchResultSchema,
  mediaDetailSchema,
} from '@antica/contracts';

import SimilarRoute from '../../app/(private)/research/similar';
import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { media } from '../media/media.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

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
const match = {
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
const result = {
  items: [match],
  nextCursor: null,
  queryAnchorId: anchorId,
  indexVersion: 'v1',
  availableScope: 'complete',
  warningsZhHant: [],
};
const comparison = {
  comparisonId: '00000000-0000-4000-8000-000000000094',
  queryAnchorId: anchorId,
  selected: match.ref,
  selectedRegion: null,
  selectedCanonicalViewId: null,
  similaritiesZhHant: ['Matching silhouette'],
  differencesZhHant: ['Different foot'],
  limitsZhHant: ['Photo angle differs'],
  citations: [],
};
const searchCompareSaveCalls = 3;
const saveRetryCalls = 4;
const collectionMatch = {
  ...match,
  ref: {
    kind: 'collection' as const,
    recordId: sourceId,
    originalAssetId: imageId,
  },
  sourceLocator: null,
  sourceTitle: null,
  contributorNames: [],
};
const nextMatch = {
  ...match,
  ref: {
    ...match.ref,
    referenceImageId: '00000000-0000-4000-8000-000000000097',
  },
  sourceTitle: 'Second catalog plate',
};
const nextComparison = {
  ...comparison,
  comparisonId: '00000000-0000-4000-8000-000000000098',
  selected: nextMatch.ref,
  similaritiesZhHant: ['Matching rim'],
};

it('should search the selected scope, compare a source match and save its locator as a reference', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ anchorId, recordId: collectionRecord.id });
  const view = await renderMobile(<SimilarRoute />, {
    get: async () => collectionRecord,
    post: async () => result,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByText('Catalog plate')).toBeTruthy());
  expect(view.commands.mock.calls[0]?.[2].body).toEqual({
    mode: 'search',
    queryAnchorId: anchorId,
    includeWholeImage: true,
    scope: 'reference_library',
    filters: {},
    limit: 30,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'View source' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/sources/${sourceId}?versionId=${sourceId}&pageId=${pageId}`,
  );
  view.commands.mockResolvedValueOnce(comparison);
  await fireEvent.press(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(screen.getByText('Matching silhouette')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Description'),
    'Same silhouette, different foot',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(view.commands).toHaveBeenCalledTimes(searchCompareSaveCalls),
  );
  expect(view.commands.mock.calls[2]?.[2].body).toEqual(
    expect.objectContaining({
      expectedRecordRevision: collectionRecord.recordRevision,
      target: {
        recordId: collectionRecord.id,
        checkId: null,
        observationId: null,
        evidenceAnchorId: anchorId,
      },
      reference: { kind: 'source', locator, referenceImageId: imageId },
      comparisonId: comparison.comparisonId,
      noteZhHant: 'Same silhouette, different foot',
    }),
  );
  await waitFor(() =>
    expect(screen.queryByLabelText('Description')).toBeNull(),
  );
});

it('should discard the previous comparison while another match is pending or fails and save only its successful retry', async () => {
  const pending = Promise.withResolvers<unknown>();
  const replies = [
    { ...result, items: [match, nextMatch] },
    comparison,
    pending.promise,
    nextComparison,
    collectionRecord,
  ].values();
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ anchorId, recordId: collectionRecord.id });
  const view = await renderMobile(<SimilarRoute />, {
    get: async () => collectionRecord,
    post: async () => replies.next().value,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  expect(await screen.findByText(nextMatch.sourceTitle)).toBeTruthy();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Compare' })[0]);
  await waitFor(() =>
    expect(screen.getByText('Matching silhouette')).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: 'Add reference' })).toBeEnabled();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Compare' })[1]);
  const previousSummaryWhilePending = screen.queryByText('Matching silhouette');
  const saveWhilePending = screen.queryByRole('button', {
    name: 'Add reference',
  });
  pending.reject(new Error('Comparison unavailable'));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Comparison unavailable',
    ),
  );
  expect(previousSummaryWhilePending).toBeNull();
  expect(saveWhilePending).toBeNull();
  expect(screen.queryByText('Matching silhouette')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull();
  await fireEvent.press(screen.getAllByRole('button', { name: 'Compare' })[1]);
  await waitFor(() => expect(screen.getByText('Matching rim')).toBeTruthy());
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Add reference' })).toBeNull(),
  );
  expect(
    view.commands.mock.calls
      .filter(([path]) => path === '/v1/references')
      .map(([, , request]) => request.body),
  ).toEqual([
    expect.objectContaining({
      reference: {
        kind: 'source',
        locator,
        referenceImageId: nextMatch.ref.referenceImageId,
      },
      comparisonId: nextComparison.comparisonId,
    }),
  ]);
  view.client.clear();
});

it('should prevent saving an unlocated source match', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ anchorId, recordId: collectionRecord.id });
  const view = await renderMobile(<SimilarRoute />, {
    get: async () => collectionRecord,
    post: async () => ({
      ...result,
      items: [{ ...match, sourceLocator: null }],
    }),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByText('Catalog plate')).toBeTruthy());
  view.commands.mockResolvedValueOnce(comparison);
  await fireEvent.press(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Add reference' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Source needs review'),
  );
  expect(view.commands).toHaveBeenCalledTimes(2);
});

it('should show a search failure and allow switching to collection scope', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ anchorId });
  const view = await renderMobile(<SimilarRoute />, {
    post: async () => {
      throw new Error('Search unavailable');
    },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'My collection' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Search unavailable'),
  );
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({ scope: 'my_collection' }),
  );
});

it('should save a collection match with its comparison and retain the note after a rejected save', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ anchorId, recordId: collectionRecord.id });
  const view = await renderMobile(<SimilarRoute />, {
    get: async () => collectionRecord,
    post: async () => ({ ...result, items: [collectionMatch] }),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Compare' })).toBeTruthy(),
  );
  view.commands.mockResolvedValueOnce({
    ...comparison,
    selected: collectionMatch.ref,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Description')).toBeTruthy(),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Description'),
    'Comparable rim',
  );
  view.commands.mockRejectedValueOnce(new Error('Reference unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reference unavailable',
    ),
  );
  expect(screen.getByLabelText('Description')).toHaveDisplayValue(
    'Comparable rim',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Add reference' }));
  await waitFor(() =>
    expect(view.commands).toHaveBeenCalledTimes(saveRetryCalls),
  );
  expect(view.commands.mock.calls[3]?.[2].body).toEqual(
    expect.objectContaining({
      reference: {
        kind: 'collection',
        recordId: sourceId,
        originalAssetId: imageId,
        evidenceAnchorId: null,
      },
      noteZhHant: 'Comparable rim',
    }),
  );
});

it('should create a bounded region anchor from a selected image before searching', async () => {
  const assetId = '00000000-0000-4000-8000-000000000095';
  const viewId = '00000000-0000-4000-8000-000000000096';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    anchorId,
    recordId: collectionRecord.id,
    assetId,
    viewId,
  });
  const view = await renderMobile(<SimilarRoute />, {
    get: async (path) =>
      path.includes('/media/')
        ? {
            asset: {
              originalFileName: 'rim.jpg',
              componentIds: [],
              views: [
                { id: viewId, derivativeId: assetId, width: 1000, height: 500 },
              ],
            },
            reads: [
              {
                assetOrDerivativeId: assetId,
                url: 'https://example.com/rim.jpg',
              },
            ],
          }
        : collectionRecord,
    post: async () => result,
  });
  await waitFor(
    () =>
      expect(
        screen.getByRole('button', { name: 'Select region' }),
      ).toBeTruthy(),
    { timeout: 5000 },
  );
  view.commands.mockResolvedValueOnce({ kind: 'image', id: pageId });
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 0, locationY: 0 },
  });
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands.mock.calls[0]?.[2].body).toEqual(
    expect.objectContaining({
      mode: 'create',
      evidence: expect.objectContaining({
        originalAssetId: assetId,
        canonicalViewId: viewId,
        scope: {
          kind: 'region',
          region: { kind: 'rect', x: 0, y: 0, width: 0.25, height: 0.25 },
          cropDerivativeId: null,
        },
      }),
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(2));
  expect(view.commands.mock.calls[1]?.[2].body).toEqual(
    expect.objectContaining({
      queryAnchorId: pageId,
      includeWholeImage: false,
    }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Full image' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(view.commands).toHaveBeenCalledTimes(searchCompareSaveCalls),
  );
  expect(view.commands.mock.calls[2]?.[2].body).toEqual(
    expect.objectContaining({
      queryAnchorId: anchorId,
      includeWholeImage: true,
    }),
  );
});

it('should label partial search coverage and compare the matched image region', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ anchorId });
  const region = { kind: 'rect', x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
  const candidate = {
    ...match,
    matchingRegions: [
      { canonicalViewId: pageId, region, derivativeId: imageId },
    ],
    thumbnail: {
      assetOrDerivativeId: imageId,
      url: 'https://example.com/thumb.jpg',
    },
    contributorNames: [],
  };
  const view = await renderMobile(<SimilarRoute />, {
    post: async () => ({
      ...result,
      availableScope: 'partial',
      warningsZhHant: ['Index incomplete'],
      items: [candidate],
    }),
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(screen.getByText('Index incomplete')).toBeTruthy(),
  );
  expect(screen.getByText('Partially complete')).toBeTruthy();
  expect(screen.getByLabelText('Catalog plate')).toHaveProp('source', {
    uri: 'https://example.com/thumb.jpg',
  });
  expect(screen.getByText(/Unknown author/)).toBeTruthy();
  view.commands.mockResolvedValueOnce(comparison);
  await fireEvent.press(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(screen.getByText('Matching silhouette')).toBeTruthy(),
  );
  expect(view.commands.mock.calls[1]?.[2].body).toEqual({
    mode: 'compare',
    queryAnchorId: anchorId,
    selected: match.ref,
    selectedRegion: region,
    selectedCanonicalViewId: pageId,
  });
});

it('should keep the full-image search available after region creation is rejected', async () => {
  const assetId = '00000000-0000-4000-8000-000000000095';
  const viewId = '00000000-0000-4000-8000-000000000096';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    anchorId,
    recordId: collectionRecord.id,
    assetId,
    viewId,
  });
  const view = await renderMobile(<SimilarRoute />, {
    get: async (path) =>
      path.includes('/media/')
        ? {
            asset: {
              originalFileName: 'rim.jpg',
              componentIds: [],
              views: [
                { id: viewId, derivativeId: assetId, width: 1000, height: 500 },
              ],
            },
            reads: [
              {
                assetOrDerivativeId: assetId,
                url: 'https://example.com/rim.jpg',
              },
            ],
          }
        : collectionRecord,
    post: async () => result,
  });
  await waitFor(
    () =>
      expect(
        screen.getByRole('button', { name: 'Select region' }),
      ).toBeTruthy(),
    { timeout: 5000 },
  );
  view.commands.mockRejectedValueOnce(new Error('Evidence unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 200, locationY: 150 },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Evidence unavailable'),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(2));
  expect(view.commands.mock.calls[1]?.[2].body).toEqual(
    expect.objectContaining({
      queryAnchorId: anchorId,
      includeWholeImage: true,
    }),
  );
});

it('should wait for an image anchor when region preparation returns a processing job', async () => {
  const assetId = '00000000-0000-4000-8000-000000000095';
  const viewId = '00000000-0000-4000-8000-000000000096';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    anchorId,
    recordId: collectionRecord.id,
    assetId,
    viewId,
  });
  const view = await renderMobile(<SimilarRoute />, {
    get: async (path) =>
      path.includes('/media/')
        ? {
            asset: {
              originalFileName: 'rim.jpg',
              componentIds: [],
              views: [
                { id: viewId, derivativeId: assetId, width: 1000, height: 500 },
              ],
            },
            reads: [
              {
                assetOrDerivativeId: assetId,
                url: 'https://example.com/rim.jpg',
              },
            ],
          }
        : collectionRecord,
    post: async () => ({ jobId: pageId }),
  });
  await waitFor(
    () =>
      expect(
        screen.getByRole('button', { name: 'Select region' }),
      ).toBeTruthy(),
    { timeout: 5000 },
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 200, locationY: 150 },
  });
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Processing'),
  );
  expect(view.commands).toHaveBeenCalledTimes(1);
});

it('should recover from a comparison error and clear stale results when scope changes', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ anchorId });
  const view = await renderMobile(<SimilarRoute />, {
    post: async () => result,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByText('Catalog plate')).toBeTruthy());
  view.commands.mockRejectedValueOnce(new Error('Comparison unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Compare' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Comparison unavailable',
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'My collection' }));
  expect(screen.queryByText('Catalog plate')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Collected references' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByText('Catalog plate')).toBeTruthy());
  expect(view.commands.mock.calls.at(-1)?.[2].body).toEqual(
    expect.objectContaining({ scope: 'reference_library' }),
  );
});

it('should show media loading while a selected image is fetched', async () => {
  const assetId = '00000000-0000-4000-8000-000000000095';
  const viewId = '00000000-0000-4000-8000-000000000096';
  const pending = Promise.withResolvers<unknown>();
  jest.mocked(useLocalSearchParams).mockReturnValue({ assetId, viewId });
  const harness = await renderMobile(<SimilarRoute />, {
    get: async () => pending.promise,
  });
  expect(screen.getByRole('progressbar')).toBeTruthy();
  pending.resolve({
    asset: {
      originalFileName: 'rim.jpg',
      componentIds: [],
      views: [{ id: viewId, derivativeId: assetId, width: 1000, height: 500 }],
    },
    reads: [
      { assetOrDerivativeId: assetId, url: 'https://example.com/rim.jpg' },
    ],
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select region' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 50, locationY: 50 },
  });
  expect(harness.commands).not.toHaveBeenCalled();
});

it('should label an untitled collection thumbnail as a photo and identify its collection scope', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ anchorId });
  const response = imageSearchResultSchema.parse({
    ...result,
    items: [
      {
        ...collectionMatch,
        thumbnail: {
          assetOrDerivativeId: imageId,
          url: 'https://private.example/collection-thumb.jpg',
          expiresAt: '2027-01-01T00:00:00.000Z',
        },
      },
    ],
  });
  const view = await renderMobile(<SimilarRoute />, {
    post: async () => response,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'My collection' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Photo')).toHaveProp('source', {
      uri: 'https://private.example/collection-thumb.jpg',
    }),
  );
  expect(screen.getAllByText('My collection')).toHaveLength(2);
  expect(screen.queryByRole('button', { name: 'View source' })).toBeNull();
  view.client.clear();
});

it('should ignore another region selection while its first evidence request is pending', async () => {
  const image = mediaDetailSchema.parse({
    ...media,
    asset: {
      ...media.asset,
      kind: 'photo',
      mimeType: 'image/jpeg',
      durationMs: null,
      views: media.asset.views.map((view) => ({
        ...view,
        originalCoordinateSpace: 'image_pixels',
      })),
    },
  });
  const pending = Promise.withResolvers<unknown>();
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    assetId: image.asset.id,
  });
  const harness = await renderMobile(<SimilarRoute />, {
    get: async (path) => (path.includes('/media/') ? image : collectionRecord),
    post: async () => pending.promise,
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Select region' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 50, locationY: 50 },
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Select region' }), {
    nativeEvent: { locationX: 100, locationY: 100 },
  });
  expect(harness.commands).toHaveBeenCalledTimes(1);
  pending.resolve(
    evidenceAnchorSchema.parse({
      id: anchorId,
      kind: 'image',
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: image.asset.id,
      canonicalViewId: image.asset.views[0].id,
      scope: { kind: 'whole' },
      createdAt: collectionRecord.createdAt,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Search' })).toBeEnabled(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Full image' }));
  expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
  harness.client.clear();
});

it('should show an empty search result without offering comparison actions', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ anchorId });
  const response = imageSearchResultSchema.parse({ ...result, items: [] });
  const harness = await renderMobile(<SimilarRoute />, {
    post: async () => response,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() =>
    expect(screen.getByText('Nothing here yet.')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: 'Compare' })).toBeNull();
  harness.client.clear();
});
