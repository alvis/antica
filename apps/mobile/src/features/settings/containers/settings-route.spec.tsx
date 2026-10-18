import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { useRouter } from 'expo-router';

import SettingsRoute from '../../../app/(private)/settings';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { AuthProvider, authClient } from '../../../providers/AuthProvider';

jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock('better-auth/client/plugins', () => ({
  phoneNumberClient: () => ({}),
}));
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    getSession: jest.fn(async () => ({
      data: {
        session: { id: 'session-1' },
        user: { phoneNumber: '+85212345678' },
      },
      error: null,
    })),
    getCookie: () => '',
    signOut: jest.fn(async () => ({ data: { success: true }, error: null })),
  }),
}));
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

const router = {
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: () => false,
  push: jest.fn(),
  navigate: jest.fn(),
  dismiss: jest.fn(),
  dismissTo: jest.fn(),
  dismissAll: jest.fn(),
  canDismiss: () => false,
  setParams: jest.fn(),
  reload: jest.fn(),
  prefetch: jest.fn(),
} satisfies ReturnType<typeof useRouter>;
jest.mocked(useRouter).mockReturnValue(router);

describe('rc:SettingsRoute', () => {
  it('should show the masked collector session without environment or privacy details', async () => {
    await render(
      <AuthProvider>
        <LocaleProvider>
          <SettingsRoute />
        </LocaleProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('••••••••5678')).toBeTruthy());
    expect(screen.queryByText('Environment')).toBeNull();
    expect(screen.queryByText('Privacy')).toBeNull();
  });

  it('should switch visible settings to Traditional Chinese and back to English', async () => {
    await render(
      <AuthProvider>
        <LocaleProvider>
          <SettingsRoute />
        </LocaleProvider>
      </AuthProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: '繁體中文' }));
    await waitFor(() =>
      expect(screen.getByRole('header', { name: '設定' })).toBeTruthy(),
    );
    expect(screen.getByText('登入狀態')).toBeTruthy();
    expect(screen.queryByText('執行環境')).toBeNull();
    expect(screen.queryByText('隱私')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'English' }));
    await waitFor(() =>
      expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy(),
    );
  });

  it('should sign out before returning to login', async () => {
    await render(
      <AuthProvider>
        <LocaleProvider>
          <SettingsRoute />
        </LocaleProvider>
      </AuthProvider>,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login'));
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
  });

  it('should show an unknown number when the session has no phone', async () => {
    jest.mocked(authClient.getSession).mockResolvedValueOnce({
      data: { session: { id: 'session-1' }, user: {} },
      error: null,
    });
    await render(
      <AuthProvider>
        <LocaleProvider>
          <SettingsRoute />
        </LocaleProvider>
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('Unknown')).toBeTruthy());
  });
});
