import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import { Redirect } from 'expo-router';

import { ApiTransport } from '@antica/client';

import LoginRoute from '../../../app/login';
import { LocaleProvider } from '../../../i18n/LocaleProvider';
import { authClient, useAuth } from '../../../providers/AuthProvider';

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
      Redirect: jest.fn<typeof import('expo-router').Redirect>(() => null),
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
const resendCooldownMilliseconds = 60_000;

describe('rc:LoginRoute', () => {
  it('should move from welcome to phone entry and require a number', async () => {
    await render(
      <LocaleProvider>
        <LoginRoute />
      </LocaleProvider>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Sign in with WhatsApp' }),
    );
    expect(
      screen.getByRole('button', { name: 'Continue' }).props.accessibilityState,
    ).toEqual({ disabled: true });
    await fireEvent.changeText(
      screen.getByLabelText('Authorized phone number'),
      ' +852 1234 5678 ',
    );
    expect(
      screen.getByRole('button', { name: 'Continue' }).props.accessibilityState,
    ).toEqual({ disabled: false });
  });

  it('should send a trimmed number, accept only six digits, and refresh the session', async () => {
    const send = jest.mocked(authClient.phoneNumber.sendOtp);
    const verify = jest.mocked(authClient.phoneNumber.verify);
    const refresh = jest.fn(async () => undefined);
    jest.mocked(useAuth).mockReturnValue({ ...authValue, refresh });
    await render(
      <LocaleProvider>
        <LoginRoute />
      </LocaleProvider>,
    );

    await fireEvent.press(
      screen.getByRole('button', { name: 'Sign in with WhatsApp' }),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Authorized phone number'),
      ' +85212345678 ',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(screen.getByText('Code sent to ••••••••5678')).toBeTruthy(),
    );
    expect(send).toHaveBeenCalledWith({ phoneNumber: '+85212345678' });
    await fireEvent.changeText(
      screen.getByLabelText('Six-digit code'),
      'a12 34-567',
    );
    expect(screen.getByLabelText('Six-digit code')).toHaveProp(
      'value',
      '123456',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(verify).toHaveBeenCalledWith({
      phoneNumber: '+85212345678',
      code: '123456',
    });
  });

  it('should offer a new code when verification reports expiry', async () => {
    jest.mocked(authClient.phoneNumber.verify).mockResolvedValueOnce({
      data: null,
      error: { code: 'OTP_EXPIRED', message: 'Expired' },
    });
    await render(
      <LocaleProvider>
        <LoginRoute />
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
      '123456',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() =>
      expect(
        screen.getByText('This code has expired. Request a new code.'),
      ).toBeTruthy(),
    );
    expect(
      screen.getByRole('button', { name: 'Verify code' }).props
        .accessibilityState,
    ).toEqual({ disabled: true });
  });
});

describe('Login recovery and session navigation', () => {
  it('should keep a rejected unexpired code editable after pending verification completes', async () => {
    const pending =
      Promise.withResolvers<
        Awaited<ReturnType<typeof authClient.phoneNumber.verify>>
      >();
    jest
      .mocked(authClient.phoneNumber.verify)
      .mockReturnValueOnce(pending.promise);
    const refresh = jest.fn(async () => undefined);
    jest.mocked(useAuth).mockReturnValue({ ...authValue, refresh });
    await render(
      <LocaleProvider>
        <LoginRoute />
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
      '123456',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
    await act(async () =>
      pending.resolve({
        data: null,
        error: { code: 'INVALID_OTP', message: 'Incorrect code' },
      }),
    );
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Verify code' })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
    await fireEvent.changeText(
      screen.getByLabelText('Six-digit code'),
      '654321',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('should display a sending failure and let the collector retry', async () => {
    jest.mocked(authClient.phoneNumber.sendOtp).mockResolvedValueOnce({
      data: null,
      error: { message: 'Service unavailable' },
    });
    await render(
      <LocaleProvider>
        <LoginRoute />
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
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Service unavailable',
      ),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Six-digit code')).toBeTruthy(),
    );
  });

  it('should unlock resend when the countdown finishes', async () => {
    jest.useFakeTimers();
    try {
      await render(
        <LocaleProvider>
          <LoginRoute />
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
      await act(async () => undefined);
      expect(
        screen.getByRole('button', { name: 'Resend code (60s)' }).props
          .accessibilityState,
      ).toEqual({ disabled: true });
      await act(async () =>
        jest.advanceTimersByTime(resendCooldownMilliseconds),
      );
      expect(
        screen.getByRole('button', { name: 'Resend code' }).props
          .accessibilityState,
      ).toEqual({ disabled: false });
      await fireEvent.press(
        screen.getByRole('button', { name: 'Resend code' }),
      );
      await act(async () => undefined);
      expect(authClient.phoneNumber.sendOtp).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('should route an authenticated collector to the collection', async () => {
    jest
      .mocked(useAuth)
      .mockReturnValueOnce({ ...authValue, authenticated: true });
    await render(
      <LocaleProvider>
        <LoginRoute />
      </LocaleProvider>,
    );
    expect(jest.mocked(Redirect).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ href: '/collection' }),
    );
  });
});
