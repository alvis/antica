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
});
