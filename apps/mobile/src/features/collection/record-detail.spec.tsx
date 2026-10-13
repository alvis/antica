import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';
import { Linking } from 'react-native';

import RecordRoute from '../../app/(private)/collection/[recordId]';
import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { media } from '../media/media.spec.fixtures';

import {
  observationId,
  pageId,
  savedReferences,
  sourceId,
  sourceVersionId,
} from './record.spec.fixtures';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const photo = {
  ...media,
  asset: {
    ...media.asset,
    kind: 'photo' as const,
    originalFileName: 'bowl.jpg',
    mimeType: 'image/jpeg',
  },
};

it('should show a record, open capture, and save trimmed edits against its revision', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : { items: [], nextCursor: null },
  });
  await waitFor(() => expect(screen.getAllByText('A-001')).toHaveLength(2));
  expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
  expect(screen.getByText('Not analyzed')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence' }));
  expect(view.router.push).toHaveBeenCalledWith(
    `/capture?recordId=${collectionRecord.id}`,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '  Blue bowl  ');
  await fireEvent.changeText(
    screen.getByLabelText('Description'),
    'Blue glaze',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.patches).toHaveBeenCalledTimes(1));
  expect(view.patches.mock.calls[0]).toEqual([
    `/v1/records/${collectionRecord.id}`,
    expect.anything(),
    expect.objectContaining({
      body: {
        expectedRevision: 1,
        fields: { name: 'Blue bowl', description: 'Blue glaze' },
      },
    }),
  ]);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy(),
  );
});

it('should start analysis explicitly and keep the check context on a signed photo', async () => {
  const checkId = '00000000-0000-4000-8000-000000000051';
  const runId = '00000000-0000-4000-8000-000000000052';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    checkId,
  });
  const record = {
    ...collectionRecord,
    mediaIds: [photo.asset.id],
    checkIds: [checkId],
    latestRunId: runId,
    analysisFreshness: 'outdated' as const,
    recordRevision: 4,
  };
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? record
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
    post: async () => ({ runId, jobId: runId }),
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Analyze again' })).toBeEnabled(),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  expect(screen.getByLabelText('bowl.jpg')).toHaveProp('source', {
    uri: media.reads[0].url,
  });
  expect(screen.getByText('New evidence not analyzed')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Results' }));
  await fireEvent.press(screen.getByRole('button', { name: /^Checks / }));
  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/media/${photo.asset.id}?checkId=${checkId}`],
    [`/analysis/${runId}`],
    [`/checks/${checkId}`],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze again' }));
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  expect(view.commands.mock.calls[0]).toEqual([
    `/v1/records/${collectionRecord.id}/analyses`,
    expect.anything(),
    expect.objectContaining({ body: { expectedRecordRevision: 4 } }),
  ]);
  expect(view.router.push).toHaveBeenCalledWith(`/analysis/${runId}`);
});

it('should create a whole-photo evidence anchor before opening similar-image research', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
    post: async () => ({
      id: '00000000-0000-4000-8000-000000000053',
      kind: 'image',
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: photo.asset.id,
      canonicalViewId: photo.asset.views[0].id,
      scope: { kind: 'whole' },
      createdAt: collectionRecord.createdAt,
    }),
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() => expect(view.commands).toHaveBeenCalledTimes(1));
  const request = view.commands.mock.calls[0][2];
  expect(request.body).toEqual({
    requestKey: request.idempotencyKey,
    mode: 'create',
    evidence: {
      kind: 'image',
      recordId: collectionRecord.id,
      componentIds: [],
      originalAssetId: photo.asset.id,
      canonicalViewId: photo.asset.views[0].id,
      scope: { kind: 'whole' },
    },
  });
  expect(view.router.push).toHaveBeenCalledWith(
    `/research/similar?anchorId=00000000-0000-4000-8000-000000000053&recordId=${collectionRecord.id}&assetId=${photo.asset.id}&viewId=${photo.asset.views[0].id}`,
  );
});

it('should keep the collector on the record while image evidence processes or fails', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Find similar images' }),
    ).toBeTruthy(),
  );
  view.commands.mockResolvedValueOnce({ kind: 'job' });
  view.commands.mockRejectedValueOnce(new Error('Offline'));
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Processing'),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Find similar images' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Offline'),
  );
  expect(view.router.push).not.toHaveBeenCalled();
});

it('should reopen observations, video, and saved collection, page, and web references', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    observationId,
  });
  const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? {
            ...collectionRecord,
            name: 'Blue bowl',
            description: 'Blue glaze',
            location: { locationId: null, detail: 'Cabinet' },
            mediaIds: [media.asset.id],
            analysisFreshness: 'current',
          }
        : path === `/v1/media/${media.asset.id}`
          ? media
          : path.endsWith('/observations')
            ? {
                items: [
                  { id: observationId, text: 'Blue decoration' },
                  {
                    id: '00000000-0000-4000-8000-000000000061',
                    text: 'Base mark',
                  },
                ],
                nextCursor: null,
              }
            : { items: savedReferences, nextCursor: null },
  });
  await waitFor(() => expect(screen.getByText('Blue decoration')).toBeTruthy());
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: 'View source' })).toHaveLength(
      savedReferences.length,
    ),
  );
  expect(screen.getByText('Blue glaze')).toBeTruthy();
  expect(screen.getByText('Saved')).toBeTruthy();
  expect(screen.getByText('collection')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'Find similar images' }),
  ).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'View' }));
  for (const button of screen.getAllByRole('button', { name: 'View source' })) {
    await fireEvent.press(button);
  }
  expect(jest.mocked(view.router.push).mock.calls).toEqual([
    [`/media/${media.asset.id}`],
    [`/media/${media.asset.id}`],
    [`/sources/${sourceId}?versionId=${sourceVersionId}&pageId=${pageId}`],
  ]);
  expect(openURL).toHaveBeenCalledWith('https://museum.example/bowl');
});

it('should show failed analysis and stale edit without discarding the edit', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? { ...collectionRecord, mediaIds: [photo.asset.id] }
        : path === `/v1/media/${photo.asset.id}`
          ? photo
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Analyze' })).toBeEnabled(),
  );
  view.commands.mockRejectedValueOnce(new Error('Analysis unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Analyze' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Analysis unavailable'),
  );
  expect(view.router.push).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '   ');
  view.patches.mockRejectedValueOnce(new Error('Revision changed'));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Revision changed'),
  );
  expect(view.patches.mock.calls[0][2].body).toEqual({
    expectedRevision: 1,
    fields: { name: null, description: '' },
  });
  expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
});

it('should retry a failed record read and restore its actions', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  const readRecord = jest
    .fn<() => Promise<unknown>>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValue(collectionRecord);
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? readRecord()
        : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy(),
  );
  expect(
    view.reads.mock.calls.filter(
      ([path]) => path === `/v1/records/${collectionRecord.id}`,
    ),
  ).toHaveLength(2);
});

it('should report a saved web reference that cannot be opened', async () => {
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: collectionRecord.id });
  jest
    .spyOn(Linking, 'openURL')
    .mockRejectedValue(new Error('Link unavailable'));
  const view = await renderMobile(<RecordRoute />, {
    get: async (path) =>
      path === `/v1/records/${collectionRecord.id}`
        ? collectionRecord
        : path.endsWith('/references')
          ? {
              items: [
                {
                  id: '00000000-0000-4000-8000-000000000062',
                  noteZhHant: 'Museum site',
                  reference: {
                    kind: 'source',
                    referenceImageId: null,
                    locator: {
                      kind: 'web',
                      sourceId: '00000000-0000-4000-8000-000000000063',
                      sourceVersionId: '00000000-0000-4000-8000-000000000064',
                      url: 'https://museum.example/bowl',
                    },
                  },
                },
              ],
              nextCursor: null,
            }
          : { items: [], nextCursor: null },
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'View source' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'View source' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Link unavailable'),
  );
  expect(view.router.push).not.toHaveBeenCalled();
});
