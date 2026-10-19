import { describe, expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';

import { File } from 'expo-file-system';

import { useShotCleanup } from './useShotCleanup';

import type { LocalMedia } from '../../../adapters/media-upload';

jest.mock('expo-file-system', () => ({
  File: jest.fn(function LocalFile(this: { delete: () => void }, uri: string) {
    this.delete = () => {
      if (uri.includes('gone')) {
        throw new Error('No such file');
      }
    };
  }),
}));

/**
 * builds a draft photo
 * @param id file identifier
 * @param overrides fields that differ from a local in-app camera shot
 * @returns the draft photo
 */
function photo(id: string, overrides: Partial<LocalMedia> = {}): LocalMedia {
  return {
    id,
    uri: `file:///${id}.jpg`,
    name: `${id}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    shotType: 'set',
    ...overrides,
  };
}

describe('fn:useShotCleanup', () => {
  it('should delete only camera shots that never left the device when the draft is discarded', async () => {
    const view = await renderHook(
      (files: LocalMedia[]) => useShotCleanup(files),
      { initialProps: [photo('first')] },
    );
    await view.rerender([
      photo('kept'),
      photo('left-out', { excluded: true }),
      photo('gone'),
      photo('uploaded', { state: 'uploaded', assetId: 'asset-uploaded' }),
      photo('uploading', { state: 'uploading' }),
      photo('retry', { state: 'failed' }),
      photo('imported', { shotType: undefined }),
    ]);

    expect(File).not.toHaveBeenCalled();
    await view.unmount();

    // an already missing shot is skipped without an error
    expect(jest.mocked(File).mock.calls.map(([uri]) => uri)).toEqual([
      'file:///kept.jpg',
      'file:///left-out.jpg',
      'file:///gone.jpg',
    ]);
  });
});
