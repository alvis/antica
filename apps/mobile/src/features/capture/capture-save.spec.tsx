import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { launchImageLibraryAsync } from 'expo-image-picker';
import { useLocalSearchParams } from 'expo-router';

import {
  evidenceAnchorSchema,
  evidenceCreateRequestSchema,
  mediaDetailSchema,
  observationSchema,
  recordDetailSchema,
} from '@antica/contracts';

import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

import { media } from '../media/media.spec.fixtures';

import { CaptureContainer } from './CaptureContainer';
import { uploadMedia } from './media-upload';

jest.mock('../../auth', () => ({ useAuth: jest.fn() }));
jest.mock('./media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: jest.fn(() => ({})),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///vase.jpg', fileName: 'vase.jpg', mimeType: 'image/jpeg' },
    ],
  })),
}));

const assetId = '00000000-0000-4000-8000-000000000022';
const checkId = '00000000-0000-4000-8000-000000000033';

/**
 * Opens a capture at its description step, ready for field entry.
 * @param kind Record unit kind selected in the opening step.
 * @param componentLabel Optional label for the selected object's component.
 * @returns Isolated mobile API and navigation boundaries.
 */
async function openFields(
  kind: 'Single item' | 'Set' = 'Single item',
  componentLabel?: string,
): Promise<Awaited<ReturnType<typeof renderMobile>>> {
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) =>
      path === '/v1/locations'
        ? [{ id: '00000000-0000-4000-8000-000000000044', label: 'Gallery' }]
        : collectionRecord,
  });
  await fireEvent.press(screen.getByRole('button', { name: kind }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  if (componentLabel) {
    await fireEvent.changeText(
      screen.getByLabelText('Component label'),
      componentLabel,
    );
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));

  return view;
}

it('should save edited set fields, existing location, components, and object image', async () => {
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await openFields('Set', 'Lid');
  await fireEvent.changeText(
    screen.getByLabelText('Prepared description'),
    'Blue glaze with an uncertain date',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Adopt description' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '  Blue vase  ');
  await fireEvent.changeText(
    screen.getByLabelText('Object type tag'),
    '  Ceramic  ',
  );
  await fireEvent.changeText(screen.getByLabelText('Height (cm)'), '12.5');
  await fireEvent.press(screen.getByRole('button', { name: 'mm' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Gallery' }));
  await fireEvent.changeText(
    screen.getByLabelText('Detailed location'),
    'Shelf 2',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}`,
    ),
  );
  expect(view.patches.mock.calls[0]?.[2]).toMatchObject({
    body: {
      expectedRevision: 1,
      fields: {
        name: 'Blue vase',
        description: 'Blue glaze with an uncertain date',
        unitKind: 'set',
        pieceCount: 2,
        components: [{ label: 'Lid' }],
        tags: ['Ceramic'],
        dimensions: { height: { value: 12.5, unit: 'mm' } },
        location: {
          locationId: '00000000-0000-4000-8000-000000000044',
          detail: 'Shelf 2',
        },
      },
    },
  });
  expect(jest.mocked(uploadMedia).mock.calls[0]?.[3]).toEqual([
    expect.any(String),
  ]);
  view.client.clear();
});

it('should require original words confirmation before saving and keep an image requirement', async () => {
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: true,
    assets: null,
  });
  const view = await openFields();
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    'Maker mark on base',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(view.patches).not.toHaveBeenCalled();
  expect(view.router.replace).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(view.router.replace).not.toHaveBeenCalled();
  view.client.clear();
});

it('should create a new location and link the uploaded photo as check evidence', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await openFields();
  view.reads.mockImplementation(async (path) =>
    path === '/v1/locations'
      ? []
      : path === `/v1/media/${assetId}`
        ? { asset: { views: [{ id: assetId }] } }
        : collectionRecord,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Location'), 'New cabinet');
  view.commands.mockImplementation(async (path) =>
    path === '/v1/locations'
      ? { id: assetId, label: 'New cabinet' }
      : collectionRecord,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}?checkId=${checkId}`,
    ),
  );
  expect(view.commands.mock.calls.map(([path]) => path)).toEqual([
    '/v1/records',
    '/v1/locations',
    '/v1/evidence',
  ]);
  expect(view.commands.mock.calls[2]?.[2]).toMatchObject({
    body: {
      checkId,
      evidence: {
        kind: 'image',
        recordId: collectionRecord.id,
        originalAssetId: assetId,
        canonicalViewId: assetId,
      },
    },
  });
  view.client.clear();
});

it('should retry failed check linking with the same request key and uploaded image', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await openFields();
  view.reads.mockImplementation(async (path) =>
    path === '/v1/locations'
      ? []
      : path === `/v1/media/${assetId}`
        ? { asset: { views: [{ id: assetId }] } }
        : collectionRecord,
  );
  view.commands.mockRejectedValueOnce(new Error('Evidence unavailable'));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  expect(view.router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}?checkId=${checkId}`,
    ),
  );
  expect(uploadMedia).toHaveBeenCalledTimes(1);
  expect(view.patches).toHaveBeenCalledTimes(1);
  expect(view.commands.mock.calls[1]?.[2]?.idempotencyKey).toBe(
    view.commands.mock.calls[2]?.[2]?.idempotencyKey,
  );
  view.client.clear();
});

it('should show a record save failure and allow retry without losing the photo', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await openFields();
  view.patches.mockRejectedValueOnce(new Error('Revision conflict'));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Revision conflict'),
  );
  expect(view.router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}`,
    ),
  );
  expect(uploadMedia).toHaveBeenCalledTimes(1);
  view.client.clear();
});

it('should save a receipt separately from object evidence and honor a return to centimeters', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await openFields();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'mm' }));
  await fireEvent.press(screen.getByRole('button', { name: 'cm' }));
  await fireEvent.changeText(screen.getByLabelText('Height (cm)'), '18');
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: 'file:///receipt.jpg',
        fileName: 'receipt.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  await fireEvent.press(
    screen.getByRole('button', { name: 'Purchase receipt' }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/receipt.jpg/)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  expect(view.patches.mock.calls[0]?.[2].body).toMatchObject({
    fields: { dimensions: { height: { value: 18, unit: 'cm' } } },
  });
  expect(
    jest.mocked(uploadMedia).mock.calls.map(([, file]) => ({
      name: file.name,
      purpose: file.purpose,
    })),
  ).toEqual([
    { name: 'vase.jpg', purpose: 'object' },
    { name: 'receipt.jpg', purpose: 'receipt' },
  ]);
  view.client.clear();
});

it('should reuse an existing set component for multiple photos and clear erased fields', async () => {
  const componentId = '00000000-0000-4000-8000-000000000055';
  const record = recordDetailSchema.parse({
    ...collectionRecord,
    name: 'Covered bowl',
    tags: ['ceramic'],
    unitKind: 'set',
    pieceCount: 2,
    components: [{ id: componentId, label: 'Lid' }],
  });
  jest
    .mocked(useLocalSearchParams)
    .mockReturnValue({ recordId: record.id, checkId });
  const secondAssetId = '00000000-0000-4000-8000-000000000057';
  jest
    .mocked(uploadMedia)
    .mockResolvedValueOnce(assetId)
    .mockResolvedValueOnce(secondAssetId);
  jest.mocked(launchImageLibraryAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [
      {
        uri: 'file:///lid-top.jpg',
        fileName: 'lid-top.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
      {
        uri: 'file:///lid-base.jpg',
        fileName: 'lid-base.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 480,
      },
    ],
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: async (path) => {
      if (path === '/v1/locations') {
        return [];
      }
      if (!path.startsWith('/v1/media/')) {
        return record;
      }
      const id = path.slice('/v1/media/'.length);

      return mediaDetailSchema.parse({
        ...media,
        asset: {
          ...media.asset,
          id,
          kind: 'photo',
          mimeType: 'image/jpeg',
          originalFileName: 'lid.jpg',
          componentIds: [componentId],
          durationMs: null,
          views: [
            {
              ...media.asset.views[0],
              id,
              originalAssetId: id,
              originalCoordinateSpace: 'image_pixels',
            },
          ],
        },
      });
    },
    patch: async () => record,
  });
  view.commands.mockImplementation(async (_path, _schema, options) => {
    const request = evidenceCreateRequestSchema.parse(options.body);
    if (request.mode !== 'create') {
      throw new Error('Expected evidence creation');
    }

    return evidenceAnchorSchema.parse({
      ...request.evidence,
      id: request.evidence.originalAssetId,
      createdAt: record.createdAt,
    });
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(
    screen.getAllByLabelText('Component label')[0],
    'Lid',
  );
  await fireEvent.changeText(
    screen.getAllByLabelText('Component label')[1],
    'Lid',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Name'), '');
  await fireEvent.changeText(
    screen.getByLabelText('Object type tag'),
    'ceramic',
  );
  await fireEvent.changeText(screen.getByLabelText('Object type tag'), '');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${record.id}?checkId=${checkId}`,
    ),
  );
  expect(view.patches.mock.calls[0]?.[2].body).toMatchObject({
    fields: {
      name: null,
      tags: [],
      components: [{ id: componentId, label: 'Lid' }],
      pieceCount: 2,
    },
  });
  expect(
    jest.mocked(uploadMedia).mock.calls.map(([, file, , componentIds]) => ({
      name: file.name,
      componentIds,
    })),
  ).toEqual([
    { name: 'lid-top.jpg', componentIds: [componentId] },
    { name: 'lid-base.jpg', componentIds: [componentId] },
  ]);
  expect(view.commands.mock.calls.map(([, , options]) => options.body)).toEqual(
    [
      expect.objectContaining({
        checkId,
        evidence: expect.objectContaining({
          componentIds: [componentId],
          originalAssetId: assetId,
        }),
      }),
      expect.objectContaining({
        checkId,
        evidence: expect.objectContaining({
          componentIds: [componentId],
          originalAssetId: secondAssetId,
        }),
      }),
    ],
  );
  view.client.clear();
});

it('should associate confirmed typed original words with the check being captured', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({ checkId });
  const view = await openFields();
  const observation = observationSchema.parse({
    id: '00000000-0000-4000-8000-000000000056',
    recordId: collectionRecord.id,
    componentIds: [],
    channel: 'typed',
    text: 'The foot rim is unglazed',
    evidenceAnchorIds: [],
    checkIds: [checkId],
    observedAt: collectionRecord.createdAt,
    voice: null,
    editDraftId: null,
    supersedesObservationId: null,
    author: 'collector',
    createdAt: collectionRecord.createdAt,
    supersededByObservationId: null,
  });
  view.commands.mockResolvedValueOnce(observation);
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    observation.text,
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByText('Original words confirmed')).toBeTruthy(),
  );
  expect(view.commands.mock.calls.at(-1)?.[2].body).toMatchObject({
    text: observation.text,
    channel: 'typed',
    checkIds: [checkId],
  });
  view.client.clear();
});
