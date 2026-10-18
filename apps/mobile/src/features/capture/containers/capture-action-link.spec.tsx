import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { useLocalSearchParams } from 'expo-router';

import { analysisRunDetailSchema } from '@antica/contracts';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import {
  actionId,
  actionableRun,
} from '../../analysis/containers/analysis.spec.fixtures';

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

it('should refuse an action its run no longer lists', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(
      analysisRunDetailSchema.parse({
        ...actionableRun,
        status: 'running',
        result: { ...actionableRun.result, output: null },
      }),
    ),
  });

  await waitFor(() =>
    expect(screen.getByTestId('capture-action-problem')).toHaveTextContent(
      'This action is no longer in the analysis.',
    ),
  );
  expect(screen.queryByText(/^Answering:/)).toBeNull();
  expect(screen.queryByTestId('capture-action-unlinked')).toBeNull();
  view.client.clear();
});

it('should link evidence to the check the loaded action names, not one in the link', async () => {
  const otherCheckId = '00000000-0000-4000-8000-000000000099';
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
    checkId: otherCheckId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(runWith({ ...photoAction, checkId })),
    post: async () => ({ id: anchorId }),
  });

  await waitFor(() =>
    expect(screen.getByTestId('capture-action-check')).toBeTruthy(),
  );
  await importAndSave();

  await waitFor(() =>
    expect(view.router.replace).toHaveBeenCalledWith(
      `/collection/${collectionRecord.id}?checkId=${checkId}`,
    ),
  );
  expect(view.commands.mock.calls[0]?.[2]).toMatchObject({
    body: { checkId },
  });
  expect(
    view.patches.mock.calls.find(([path]) => path === actionPath)?.[2],
  ).toMatchObject({ body: { support: { checkIds: [checkId] } } });
  view.client.clear();
});

/**
 * builds a run that suggested its action for a different record
 * @returns the parsed run
 */
const foreignRun = (): ReturnType<typeof runWith> =>
  analysisRunDetailSchema.parse({
    ...runWith({ ...photoAction, checkId }),
    recordId: '00000000-0000-4000-8000-000000000098',
  });

it('should create nothing for an action of another record', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
  });
  jest.mocked(uploadMedia).mockResolvedValue(assetId);
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(foreignRun()),
    post: async () => ({ id: anchorId }),
  });

  await waitFor(() =>
    expect(screen.getByTestId('capture-action-problem')).toHaveTextContent(
      'This action belongs to another item, so nothing was added.',
    ),
  );
  await importAndSave();

  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(uploadMedia).not.toHaveBeenCalled();
  expect(view.commands).not.toHaveBeenCalled();
  expect(view.patches).not.toHaveBeenCalled();
  expect(view.router.replace).not.toHaveBeenCalled();
  view.client.clear();
});

it('should save no words for an action of another record', async () => {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    recordId: collectionRecord.id,
    runId,
    actionId,
    mode: 'describe',
  });
  const view = await renderMobile(<CaptureContainer />, {
    get: readsFor(foreignRun()),
    post: async () => ({ id: observationId }),
  });
  await waitFor(() => expect(screen.getByText('4 / 6')).toBeTruthy());
  await fireEvent.changeText(
    screen.getByLabelText('Original words'),
    'The foot ring is unglazed',
  );

  await fireEvent.press(
    screen.getByRole('button', { name: 'Confirm original words' }),
  );

  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(view.commands).not.toHaveBeenCalled();
  view.client.clear();
});
