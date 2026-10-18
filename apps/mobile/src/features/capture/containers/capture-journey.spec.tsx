import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { uploadMedia } from '../../../adapters/media-upload';
import { collectionRecord, renderMobile } from '../../../mobile.spec.fixtures';

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
  useLocalSearchParams: () => ({}),
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
  launchImageLibraryAsync: async () => ({
    canceled: false,
    assets: [
      { uri: 'file:///one.jpg', fileName: 'one.jpg', mimeType: 'image/jpeg' },
      { uri: 'file:///two.jpg', fileName: 'two.jpg', mimeType: 'image/jpeg' },
    ],
  }),
}));

describe('Capture retry journey', () => {
  it('should retry only failed media without duplicating observations or starting analysis', async () => {
    jest
      .mocked(uploadMedia)
      .mockResolvedValueOnce('00000000-0000-4000-8000-000000000002')
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValueOnce('00000000-0000-4000-8000-000000000003');
    const { commands, patches, router, client } = await renderMobile(
      <CaptureContainer />,
      {
        get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
      },
    );
    await fireEvent.press(screen.getByText('Single item'));
    await waitFor(() => expect(screen.getByText('Import file')).toBeTruthy());
    await fireEvent.press(screen.getByText('Import file'));
    await fireEvent.press(screen.getByText('Continue'));
    await fireEvent.press(screen.getByText('Continue'));
    await fireEvent.changeText(
      screen.getByLabelText('Original words'),
      'Blue decoration',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: 'Confirm original words' }),
    );
    await waitFor(() =>
      expect(screen.getByText('Original words confirmed')).toBeTruthy(),
    );
    await fireEvent.press(screen.getByText('Continue'));
    await fireEvent.press(screen.getByText('Continue'));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/collection/${collectionRecord.id}`,
      ),
    );
    expect(
      jest.mocked(uploadMedia).mock.calls.map((call) => call[1].name),
    ).toEqual(['one.jpg', 'two.jpg', 'two.jpg']);
    expect(commands.mock.calls.map((call) => call[0])).toEqual([
      '/v1/records',
      '/v1/observations',
    ]);
    expect(patches).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
