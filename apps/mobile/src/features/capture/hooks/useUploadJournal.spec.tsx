import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useState } from 'react';

import {
  File,
  fakeDisk,
  resetFakeDisk,
} from '../../../adapters/file-system.spec.fixtures';
import { listJournals } from '../../../adapters/upload-journal';
import { collectionRecord, collectorId } from '../../../mobile.spec.fixtures';

import { useUploadJournal } from './useUploadJournal';

import type { LocalMedia } from '../../../adapters/media-upload';

import type { CaptureDraft } from './useCaptureDraft';

jest.mock('expo-file-system', () =>
  jest.requireActual('../../../adapters/file-system.spec.fixtures'),
);
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

/**
 * builds a draft photo whose original sits in the fake cache
 * @param id file identifier
 * @param overrides fields that differ from a local photo
 * @returns the draft photo
 */
function photo(id: string, overrides: Partial<LocalMedia> = {}): LocalMedia {
  fakeDisk().files.set(`file:///cache/${id}.jpg`, 'bytes');

  return {
    id,
    uri: `file:///cache/${id}.jpg`,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    ...overrides,
  };
}

/**
 * runs the journal hook over a draft kept in component state, as the capture container does
 * @param files starting draft files
 * @returns the rendered hook with the draft and its updater
 */
async function renderJournal(files: LocalMedia[]): Promise<
  Awaited<
    ReturnType<
      typeof renderHook<
        {
          draft: CaptureDraft;
          setFiles: (files: LocalMedia[]) => void;
        },
        unknown
      >
    >
  >
> {
  return renderHook(() => {
    const [draft, setDraft] = useState({
      record: { ...collectionRecord, name: 'Celadon bowl' },
      files,
    } as CaptureDraft);
    useUploadJournal({
      draft,
      setDraft,
      resume: false,
      attempted: false,
      userId: collectorId,
    });

    return {
      draft,
      setFiles: (next: LocalMedia[]) =>
        setDraft((current) => ({ ...current, files: next })),
    };
  });
}

beforeEach(() => resetFakeDisk());

describe('fn:useUploadJournal', () => {
  it('should keep each photo once under the record name and never a voice note', async () => {
    const view = await renderJournal([
      photo('front'),
      photo('voice', { purpose: 'voice_note' }),
    ]);

    await waitFor(() =>
      expect(view.result.current.draft.files[0]?.copyUri).toBeTruthy(),
    );
    expect(listJournals(collectorId).entries).toMatchObject([
      { fileId: 'front', recordLabel: 'Celadon bowl' },
    ]);
    expect(view.result.current.draft.files[1]?.copyUri).toBeUndefined();
  });

  it('should drop the journal of an upload that finished without it', async () => {
    const view = await renderJournal([photo('front')]);
    await waitFor(() =>
      expect(listJournals(collectorId).entries).toHaveLength(1),
    );

    await act(async () =>
      view.result.current.setFiles(
        view.result.current.draft.files.map((file) => ({
          ...file,
          state: 'uploaded' as const,
        })),
      ),
    );

    expect(listJournals(collectorId).entries).toEqual([]);
  });

  it('should copy a photo once and delete a copy that finished after its draft closed', async () => {
    let finishCopy: () => void = () => undefined;
    const copy = jest
      .spyOn(File.prototype, 'copy')
      .mockImplementationOnce(async function slowCopy(this: File, target) {
        await new Promise<void>((resolve) => {
          finishCopy = resolve;
        });
        fakeDisk().files.set(target.uri, 'bytes');
      });
    const view = await renderJournal([photo('front')]);
    // a change while the copy is still being made must not copy the photo again
    await act(async () =>
      view.result.current.setFiles([...view.result.current.draft.files]),
    );
    expect(copy).toHaveBeenCalledTimes(1);
    await view.unmount();
    await act(async () => finishCopy());

    await waitFor(() =>
      expect(
        fakeDisk().directories.has(
          `file:///documents/uploads/${collectorId}/${collectionRecord.id}/front`,
        ),
      ).toBe(false),
    );
    expect(listJournals(collectorId).entries).toEqual([]);
  });
});
