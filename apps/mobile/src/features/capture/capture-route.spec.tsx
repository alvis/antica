import { expect, it, jest } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import CaptureRoute from '../../app/(private)/capture';
import { collectionRecord, renderMobile } from '../../mobile.spec.fixtures';

jest.mock(
  '../../auth',
  () =>
    ({
      useAuth: jest.fn<typeof import('../../auth').useAuth>(),
    }) satisfies Partial<typeof import('../../auth')>,
);
jest.mock('expo-router', () => ({
  useRouter: jest.fn(),
  useLocalSearchParams: () => ({}),
}));
jest.mock('expo-crypto', () => ({
  randomUUID:
    jest.requireActual<typeof import('node:crypto')>('node:crypto').randomUUID,
}));
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock(
  'expo-secure-store',
  () =>
    ({
      getItemAsync: jest.fn(async () => null),
      setItemAsync: jest.fn(async () => undefined),
    }) satisfies Partial<typeof import('expo-secure-store')>,
);
jest.mock('expo-audio', () => ({
  useAudioRecorder: () => ({}),
  RecordingPresets: { HIGH_QUALITY: {} },
}));
jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: async () => ({ canceled: true, assets: [] }),
}));

it('should begin the capture journey from its private route without starting analysis', async () => {
  const view = await renderMobile(<CaptureRoute />, {
    get: async (path) => (path === '/v1/locations' ? [] : collectionRecord),
  });

  expect(screen.getByRole('header', { name: 'Add item' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Single item' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Photo' })).toBeTruthy(),
  );
  expect(view.commands.mock.calls.map(([path]) => path)).toEqual([
    '/v1/records',
  ]);
  view.client.clear();
});
