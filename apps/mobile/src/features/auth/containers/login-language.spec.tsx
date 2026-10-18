import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { useRouter } from 'expo-router';
import { Text } from 'react-native';

import { ApiTransport } from '@antica/client';

import LoginRoute from '../../../app/login';
import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { useAuth } from '../../../providers/AuthProvider';
import {
  LocaleProvider,
  useInterfaceLanguage,
} from '../../../providers/LocaleProvider';

import type { ReactElement } from 'react';

jest.mock('@better-auth/expo/client', () => ({ expoClient: () => ({}) }));
jest.mock('better-auth/client/plugins', () => ({
  phoneNumberClient: () => ({}),
}));
jest.mock('better-auth/react', () => ({
  createAuthClient: () => ({
    phoneNumber: {
      sendOtp: jest.fn(async () => ({ data: { success: true }, error: null })),
      verify: jest.fn(async () => ({
        data: { token: 'session' },
        error: null,
      })),
    },
    getSession: jest.fn(async () => ({ data: null, error: null })),
    getCookie: () => '',
    signOut: jest.fn(async () => ({ data: { success: true }, error: null })),
  }),
}));
jest.mock(
  '../../../providers/AuthProvider',
  () =>
    ({
      ...jest.requireActual<typeof import('../../../providers/AuthProvider')>(
        '../../../providers/AuthProvider',
      ),
      useAuth:
        jest.fn<typeof import('../../../providers/AuthProvider').useAuth>(),
    }) satisfies Partial<typeof import('../../../providers/AuthProvider')>,
);
jest.mock(
  'expo-router',
  () =>
    ({
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

const authValue = {
  api: new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  }),
  authenticated: false,
  loading: false,
  phone: null,
  refresh: async () => undefined,
  signOut: async () => undefined,
  expire: () => undefined,
} satisfies ReturnType<typeof useAuth>;
jest.mocked(useAuth).mockReturnValue(authValue);

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
 * switches the interface language through the same operation as the language screen
 * @returns a pressable control that saves Traditional Chinese
 */
const SaveTraditionalChinese = (): ReactElement => {
  const { save } = useInterfaceLanguage();

  return <Text onPress={() => void save('zh-Hant')}>switch language</Text>;
};
/** time spent typing the code before the language changes */
const typingMilliseconds = 5_000;
const oneSecondMilliseconds = 1_000;

describe('Login language shortcut', () => {
  it('should open only the language selector before sign-in', async () => {
    await render(
      <LocaleProvider preferences={savedPreferences('en')}>
        <LoginRoute />
      </LocaleProvider>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Language / 語言' }),
    );

    expect(router.push.mock.calls).toEqual([['/settings/language']]);
  });

  it('should keep the entered code and countdown when the interface language changes', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <LocaleProvider preferences={savedPreferences('en')}>
          <LoginRoute />
          <SaveTraditionalChinese />
        </LocaleProvider>,
      );
      await fireEvent.press(
        screen.getByRole('button', { name: 'Sign in with WhatsApp' }),
      );
      await fireEvent.changeText(
        screen.getByLabelText('Authorized phone number'),
        '+85212345678',
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
      await waitFor(() =>
        expect(screen.getByLabelText('Six-digit code')).toBeTruthy(),
      );
      await fireEvent.changeText(
        screen.getByLabelText('Six-digit code'),
        '1234',
      );
      await act(async () => jest.advanceTimersByTime(typingMilliseconds));

      await fireEvent.press(screen.getByText('switch language'));

      expect(screen.getByLabelText('六位數驗證碼')).toHaveProp('value', '1234');
      expect(screen.getByText('驗證碼已傳送至 ••••••••5678')).toBeTruthy();
      expect(
        screen.getByRole('button', { name: '重發驗證碼 (55s)' }),
      ).toBeTruthy();
      await act(async () => jest.advanceTimersByTime(oneSecondMilliseconds));
      expect(
        screen.getByRole('button', { name: '重發驗證碼 (54s)' }),
      ).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});
