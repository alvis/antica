import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord, collectorId } from '../../../mobile.spec.fixtures';

import { useCaptureSave } from './useCaptureSave';

import type { useRouter } from 'expo-router';

import type { ApiTransport } from '@antica/client';

import type { LocalMedia } from '../../../adapters/media-upload';

import type { CaptureDraft, EditedFields } from './useCaptureDraft';

jest.mock('../../../adapters/media-upload', () => ({ uploadMedia: jest.fn() }));
jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));

const failed: LocalMedia = {
  id: 'lost',
  uri: 'file:///cache/lost.jpg',
  name: 'lost.jpg',
  mimeType: 'image/jpeg',
  kind: 'photo',
  purpose: 'object',
  componentLabel: '',
  state: 'failed',
  assetId: null,
};

/**
 * runs the save hook over a fixed draft, as the capture container would at the save step
 * @param draft record and files being saved
 * @param busy whether another save or retry is running
 * @returns the rendered hook and the busy setter it was given
 */
async function renderSave(
  draft: CaptureDraft,
  busy: boolean,
): Promise<{
  retry: (fileIds: readonly string[]) => Promise<void>;
  setBusy: jest.Mock;
}> {
  const setBusy = jest.fn();
  const view = await renderHook(() =>
    useCaptureSave(
      {
        api: {} as ApiTransport,
        t: (key) => key,
        busy,
        setBusy,
        setError: jest.fn(),
      },
      {
        draft,
        editedFields: {} as EditedFields,
        setStep: jest.fn(),
        setDraft: jest.fn(),
        update: jest.fn(),
        userId: collectorId,
        savedObservation: false,
        locations: [],
        checkId: undefined,
        actionLink: {
          linked: false,
          verify: jest.fn(async () => undefined),
          supply: jest.fn(async () => undefined),
        },
        queryClient: new QueryClient(),
        router: {} as ReturnType<typeof useRouter>,
      },
    ),
  );

  return { retry: view.result.current.retry, setBusy };
}

describe('fn:useCaptureSave', () => {
  it.each([
    ['another upload is running', true, { ...collectionRecord }],
    ['the record was never created', false, null],
  ])('should leave a retry alone while %s', async (_case, busy, record) => {
    const { retry, setBusy } = await renderSave(
      { record, files: [failed] } as CaptureDraft,
      busy,
    );

    await act(async () => retry(['lost']));

    expect(uploadMedia).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('should not save while another action runs', async () => {
    const { save, api, setBusy } = await renderAnswer(true, {
      ...uploadedPhoto,
      state: 'local',
    });

    await act(async () => save());

    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
    expect(uploadMedia).not.toHaveBeenCalled();
    expect(setBusy).not.toHaveBeenCalled();
  });

  it('should report a check photo that uploaded without an asset as failed', async () => {
    const { save, api, setError, setStep } = await renderAnswer(false, {
      ...uploadedPhoto,
      assetId: null,
    });

    await act(async () => save());

    expect(api.post).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith('uploadFailed');
    expect(setStep).toHaveBeenCalledWith(reviewStep);
  });

  it('should key a check anchor by the file when no request key was kept', async () => {
    const { save, api } = await renderAnswer(false, uploadedPhoto);

    await act(async () => save());

    expect(api.post).toHaveBeenCalledWith(
      '/v1/evidence',
      expect.anything(),
      expect.objectContaining({
        body: expect.objectContaining({ requestKey: 'shot', checkId: 'check' }),
        idempotencyKey: 'shot',
      }),
    );
  });
});

/** capture step listing the files to upload again */
const reviewStep = 6;

const uploadedPhoto: LocalMedia = {
  ...failed,
  id: 'shot',
  state: 'uploaded',
  assetId: 'asset',
};

/**
 * runs the save hook for a capture answering a check, with one photo already uploaded
 * @param busy whether another save or retry is running
 * @param photo the photo answering the check
 * @returns the save action, its transport and status spies
 */
async function renderAnswer(
  busy: boolean,
  photo: LocalMedia,
): Promise<{
  save: () => Promise<void>;
  api: Record<'get' | 'post' | 'patch', jest.Mock>;
  setBusy: jest.Mock;
  setError: jest.Mock;
  setStep: jest.Mock;
}> {
  const api = {
    get: jest.fn(async () => ({ asset: { views: [{ id: 'view' }] } })),
    post: jest.fn(async () => ({ id: 'anchor' })),
    patch: jest.fn(async () => ({ ...collectionRecord })),
  };
  const setBusy = jest.fn();
  const setError = jest.fn();
  const setStep = jest.fn();
  const view = await renderHook(() =>
    useCaptureSave(
      {
        api: api as unknown as ApiTransport,
        t: (key) => key,
        busy,
        setBusy,
        setError,
      },
      {
        draft: {
          record: { ...collectionRecord },
          files: [photo],
          originalWords: '',
          kind: collectionRecord.unitKind,
          locationLabel: '',
          locationDetail: '',
          adoptedDescription: false,
        } as unknown as CaptureDraft,
        editedFields: {} as EditedFields,
        setStep,
        setDraft: jest.fn(),
        update: jest.fn(),
        userId: collectorId,
        savedObservation: false,
        locations: [],
        checkId: 'check',
        actionLink: {
          linked: false,
          verify: jest.fn(async () => undefined),
          supply: jest.fn(async () => undefined),
        },
        queryClient: new QueryClient(),
        router: { replace: jest.fn() } as unknown as ReturnType<
          typeof useRouter
        >,
      },
    ),
  );

  return { save: view.result.current.save, api, setBusy, setError, setStep };
}
