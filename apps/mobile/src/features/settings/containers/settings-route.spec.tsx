import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { useRouter } from 'expo-router';

import SettingsRoute from '../../../app/(private)/settings';
import {
  memoryPreferences,
  savedPreferences,
} from '../../../i18n/preferences.spec.fixtures';
import { AuthProvider, authClient } from '../../../providers/AuthProvider';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import type {
  LocalPreferencesPort,
  SystemLocalePort,
} from '../../../i18n/preferences';

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

/**
 * renders Settings for a signed-in collector on a device with the given preferences
 * @param preferences device preference storage
 * @param systemLocales device languages for Follow system
 * @returns the query client whose private cache sign-out must clear
 */
async function renderSettings(
  preferences: LocalPreferencesPort,
  systemLocales: SystemLocalePort = { readLanguageTags: () => ['en-US'] },
): Promise<QueryClient> {
  const client = new QueryClient();
  await render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <LocaleProvider preferences={preferences} systemLocales={systemLocales}>
          <SettingsRoute />
        </LocaleProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );

  return client;
}

describe('rc:SettingsRoute', () => {
  it('should show Traditional Chinese as the language of a new installation on an English phone', async () => {
    await renderSettings(memoryPreferences(null));

    expect(screen.getByRole('header', { name: '我' })).toBeTruthy();
    expect(screen.getByText('語言 · 繁體中文')).toBeTruthy();
    expect(
      screen.getByText('只更改此裝置的介面語言，不會翻譯藏品內容或重新分析。'),
    ).toBeTruthy();
    await waitFor(() => expect(screen.getByText('••••••••5678')).toBeTruthy());
  });

  it('should show the saved English choice in English', async () => {
    await renderSettings(savedPreferences('en'));

    expect(screen.getByRole('header', { name: 'Me' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Language, English' }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Changes this device's interface language only. Collection content is not translated or reanalysed.",
      ),
    ).toBeTruthy();
  });

  it('should show Follow system with the language it resolves to', async () => {
    await renderSettings(savedPreferences('system'), {
      readLanguageTags: () => ['zh-CN'],
    });

    expect(screen.getByText('語言 · 跟隨系統 · 繁體中文')).toBeTruthy();
  });

  it('should open the language selector from the Language row', async () => {
    await renderSettings(savedPreferences('en'));

    await fireEvent.press(
      screen.getByRole('button', { name: 'Language, English' }),
    );

    expect(router.push.mock.calls).toEqual([['/settings/language']]);
  });
});

describe('Settings sign-out', () => {
  it('should sign out, clear the private cache, and keep the language preference', async () => {
    const preferences = {
      read: jest.fn<LocalPreferencesPort['read']>(async () => ({
        schemaVersion: 1,
        interfaceLanguage: 'en',
      })),
      write: jest.fn<LocalPreferencesPort['write']>(async () => undefined),
    };
    const client = await renderSettings(preferences);
    await waitFor(() => expect(screen.getByText('••••••••5678')).toBeTruthy());
    client.setQueryData(['records'], { items: ['private'] });

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(router.replace.mock.calls).toEqual([['/login']]),
    );
    expect(authClient.signOut).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['records'])).toBeUndefined();
    expect(preferences.write).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Me' })).toBeTruthy();
  });

  it('should leave the device signed out and clear private data when the server cannot end the session', async () => {
    const warn = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const failure = new Error('Offline');
    jest.mocked(authClient.signOut).mockRejectedValueOnce(failure);
    const client = await renderSettings(savedPreferences('en'));
    await waitFor(() => expect(screen.getByText('••••••••5678')).toBeTruthy());
    client.setQueryData(['records'], { items: ['private'] });

    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(router.replace.mock.calls).toEqual([['/login']]),
    );
    expect(client.getQueryData(['records'])).toBeUndefined();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(warn.mock.calls).toEqual([
      ['The server session could not be ended.', failure],
    ]);
  });
});

describe('Settings recovery', () => {
  it('should report an unreadable language preference and read it again', async () => {
    const preferences = {
      read: jest
        .fn<LocalPreferencesPort['read']>()
        .mockRejectedValueOnce(new Error('Keychain locked.'))
        .mockResolvedValueOnce({ schemaVersion: 1, interfaceLanguage: 'en' }),
      write: jest.fn<LocalPreferencesPort['write']>(async () => undefined),
    };
    await renderSettings(preferences);

    expect(screen.getByRole('alert')).toHaveTextContent(
      '無法讀取已儲存的語言，暫時使用繁體中文。',
    );
    await fireEvent.press(screen.getByRole('button', { name: '重試' }));

    expect(screen.getByRole('header', { name: 'Me' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('should show an unknown number when the session has no phone', async () => {
    jest.mocked(authClient.getSession).mockResolvedValueOnce({
      data: { session: { id: 'session-1' }, user: {} },
      error: null,
    });
    await renderSettings(savedPreferences('en'));

    await waitFor(() => expect(screen.getByText('Unknown')).toBeTruthy());
  });
});
