import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { File } from 'expo-file-system';
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { StrictMode } from 'react';

import { useVideoThumbnails } from './useVideoThumbnails';

import type { VideoThumbnailsResult } from 'expo-video-thumbnails';
import type { PropsWithChildren, ReactElement } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('expo-file-system', () => {
  const remove = jest.fn();

  return {
    File: Object.assign(
      jest.fn(function LocalFile(this: { delete: () => void }) {
        this.delete = remove;
      }),
      { remove },
    ),
  };
});

/** deletion mock shared by every mocked file */
const removed = (File as unknown as { remove: jest.Mock }).remove;

/**
 * builds a local draft video
 * @param id file identifier
 * @returns the draft video
 */
function video(id: string): LocalMedia {
  return {
    id,
    uri: `file:///${id}.mp4`,
    name: `${id}.mp4`,
    mimeType: 'video/mp4',
    kind: 'video',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
  };
}

/**
 * lists the files deleted so far
 * @returns deleted file URIs in order
 */
function deletedFiles(): unknown[] {
  return jest.mocked(File).mock.calls.map(([uri]) => uri);
}

/**
 * renders inside StrictMode, which runs every effect twice on mount
 * @param props hook host
 * @returns the strict tree
 */
const Strict = (props: PropsWithChildren): ReactElement => (
  <StrictMode>{props.children}</StrictMode>
);

/**
 * holds a still back until the test settles it
 * @param settle queue of pending settlements the test runs later
 * @param uri still the request yields, or null for a request that fails
 * @returns the pending request
 */
async function held(
  settle: Array<() => void>,
  uri: string | null,
): Promise<VideoThumbnailsResult> {
  return new Promise((resolve, reject) => {
    settle.push(() =>
      uri
        ? resolve({ uri, width: 64, height: 48 })
        : reject(new Error('Unsupported codec')),
    );
  });
}

beforeEach(() => {
  jest.mocked(getThumbnailAsync).mockImplementation(async (uri) => ({
    uri: uri.replace('.mp4', '.jpg'),
    width: 64,
    height: 48,
  }));
});

describe('fn:useVideoThumbnails', () => {
  it('should ask once per video even when StrictMode runs the effect twice', async () => {
    const files = [video('turn')];
    const view = await renderHook(() => useVideoThumbnails(files), {
      wrapper: Strict,
    });

    await waitFor(() =>
      expect(view.result.current).toEqual({ turn: 'file:///turn.jpg' }),
    );
    expect(getThumbnailAsync).toHaveBeenCalledTimes(1);
    expect(removed).not.toHaveBeenCalled();
  });

  it('should delete a still when its video leaves the draft, and every still with the draft', async () => {
    const view = await renderHook(
      (files: LocalMedia[]) => useVideoThumbnails(files),
      { initialProps: [video('turn'), video('base')] },
    );
    await waitFor(() =>
      expect(Object.keys(view.result.current)).toHaveLength(2),
    );

    await view.rerender([video('base')]);

    expect(deletedFiles()).toEqual(['file:///turn.jpg']);
    await view.unmount();

    expect(deletedFiles()).toEqual(['file:///turn.jpg', 'file:///base.jpg']);
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('should delete a still that arrives after the draft is gone instead of showing it', async () => {
    const settle: Array<() => void> = [];
    jest
      .mocked(getThumbnailAsync)
      .mockImplementationOnce(async () => held(settle, 'file:///late.jpg'))
      .mockImplementationOnce(async () => held(settle, null));
    const view = await renderHook(() =>
      useVideoThumbnails([video('late'), video('broken')]),
    );

    await view.unmount();
    await act(async () => settle.forEach((done) => done()));

    expect(deletedFiles()).toEqual(['file:///late.jpg']);
  });

  it('should leave nothing to delete for a video whose still cannot be made', async () => {
    jest
      .mocked(getThumbnailAsync)
      .mockRejectedValueOnce(new Error('Unsupported codec'));
    const view = await renderHook(() => useVideoThumbnails([video('broken')]));

    await waitFor(() => expect(view.result.current).toEqual({ broken: null }));
    await view.unmount();

    expect(removed).not.toHaveBeenCalled();
  });
});
