import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { ApiError } from '@antica/client';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import { actionId } from '../../analysis/containers/analysis.spec.fixtures';

import {
  actionPath,
  anchorId,
  assetId,
  checkId,
  importAndSave,
  observationId,
  photoAction,
  readsFor,
  runWith,
} from './capture-action.spec.fixtures';
import { CaptureContainer } from './CaptureContainer';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
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
      { uri: 'file:///base.jpg', fileName: 'base.jpg', mimeType: 'image/jpeg' },
    ],
  })),
}));

it('should link a photo for a checked action to its check and supply the action', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith({ ...photoAction, checkId })),
    post: async () => ({ id: anchorId }),
  });

  await waitFor(() =>
    expect(
      screen.getByText('Answering: Photograph the entire base'),
    ).toBeTruthy(),
  );
  expect(screen.getByTestId('capture-action-check')).toHaveTextContent(
    'New evidence is linked to check 00000000.',
  );
  await importAndSave();

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}?checkId=${checkId}`,
    ),
  );
  expect(view.commands.mock.calls[0]?.[2]).toMatchObject({
    body: { mode: 'create', checkId, evidence: { originalAssetId: assetId } },
  });
  const supply = view.patches.mock.calls.find(([path]) => path === actionPath);
  expect(supply?.[2]).toMatchObject({
    body: {
      status: 'supplied',
      expectedActionRevision: 1,
      expectedRecordRevision: collectionRecord.recordRevision,
      support: { evidenceAnchorIds: [anchorId], checkIds: [checkId] },
    },
  });
  expect(view.commands.mock.calls.map(([path]) => path)).not.toContain(
    `/v1/records/${collectionRecord.id}/analyses`,
  );
  view.client.clear();
});

it('should keep an action without a check actionable by linking the photo to the record only', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith(photoAction)),
    post: async () => ({ id: anchorId }),
  });

  await waitFor(() =>
    expect(screen.getByTestId('capture-action-unlinked')).toHaveTextContent(
      'This action has no check; new evidence is added to this item only.',
    ),
  );
  await importAndSave();

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}`,
    ),
  );
  expect(
    (view.commands.mock.calls[0]?.[2] as { body: { checkId?: string } }).body
      .checkId,
  ).toBeUndefined();
  const supply = view.patches.mock.calls.find(([path]) => path === actionPath);
  expect(supply?.[2]).toMatchObject({
    body: { support: { evidenceAnchorIds: [anchorId] } },
  });
  expect(
    (supply?.[2] as { body: { support: object } }).body.support,
  ).not.toHaveProperty('checkIds');
  view.client.clear();
});

it('should keep a supplied action as saved when more evidence is captured for it', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith(photoAction, 'supplied')),
    post: async () => ({ id: anchorId }),
  });

  await importAndSave();

  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  expect(view.patches.mock.calls.map(([path]) => path)).not.toContain(
    actionPath,
  );
  view.client.clear();
});

it('should retry only the action link after it fails, without another upload or anchor', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith({ ...photoAction, checkId })),
    post: async () => ({ id: anchorId }),
  });
  let actionFailed = false;
  view.patches.mockImplementation(async (path) => {
    if (path === actionPath && !actionFailed) {
      actionFailed = true;
      throw new TypeError('Network request failed');
    }

    return collectionRecord;
  });

  await importAndSave();
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Connect to the internet and retry.',
    ),
  );
  expect(view.router.replace).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => expect(view.router.replace).toHaveBeenCalled());
  expect(uploadMedia).toHaveBeenCalledTimes(1);
  expect(view.commands).toHaveBeenCalledTimes(1);
  // the same supply sent again keeps its key, so a lost reply cannot apply it twice
  const keys = view.patches.mock.calls
    .filter(([path]) => path === actionPath)
    .map((call) => (call[2] as { idempotencyKey: string }).idempotencyKey);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  view.client.clear();
});

it('should open a description answer at the words step and supply the action with the observation', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
    mode: 'describe',
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith({ checkId })),
    post: async () => ({ id: observationId }),
  });

  await waitFor(() => expect(screen.getByText('4 / 6')).toBeTruthy());
  expect(screen.queryByTestId('capture-action-finish')).toBeNull();
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    'The foot ring is unglazed',
  );
  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('capture-action-finish')).toBeTruthy(),
  );
  expect(view.commands.mock.calls[0]?.[2]).toMatchObject({
    body: { text: 'The foot ring is unglazed', checkIds: [checkId] },
  });
  view.patches.mockRejectedValueOnce(
    new ApiError({
      status: 409,
      code: 'REVISION_CONFLICT',
      message: 'Action revision changed',
    }),
  );
  await fireEvent.press(screen.getByTestId('capture-action-finish'));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This action changed. Return to the analysis and try again.',
    ),
  );
  expect(screen.queryByText('Action revision changed')).toBeNull();
  await fireEvent.press(screen.getByTestId('capture-action-finish'));

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(`/analysis/${runId}`),
  );
  expect(view.patches.mock.calls.at(-1)?.[2]).toMatchObject({
    body: {
      status: 'supplied',
      support: { observationIds: [observationId], checkIds: [checkId] },
    },
  });
  view.client.clear();
});
