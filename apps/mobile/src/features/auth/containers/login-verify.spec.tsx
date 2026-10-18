import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { authClient, useAuth } from '../../../providers/AuthProvider';

import { authValue, openCodeStep } from './login.spec.fixtures';

import type { VerifyResult } from './login.spec.fixtures';

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
      useRouter: jest.fn<typeof import('expo-router').useRouter>(),
    }) satisfies Partial<typeof import('expo-router')>,
);

jest.mocked(useAuth).mockReturnValue(authValue);

/** wait before another code may be requested */
const resendCooldownMilliseconds = 60_000;

it('should announce verifying and submit the same code once for repeated taps and Enter', async () => {
  const pending = Promise.withResolvers<VerifyResult>();
  jest
    .mocked(authClient.phoneNumber.verify)
    .mockReturnValueOnce(pending.promise);
  const refresh = jest.fn(async () => true);
  jest.mocked(useAuth).mockReturnValue({ ...authValue, refresh });
  await openCodeStep();
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '482619');
  const verifyButton = screen.getByTestId('login-verify');
  await act(async () => {
    void fireEvent.press(verifyButton);
    void fireEvent.press(verifyButton);
    void fireEvent(screen.getByLabelText('Six-digit code'), 'submitEditing');
  });

  const busy = screen.getByRole('button', { name: 'Verifying…' });
  expect(busy.props.accessibilityState).toEqual({
    busy: true,
    disabled: true,
  });
  expect(screen.getByTestId('login-verify-spinner')).toBeTruthy();
  expect(screen.getByTestId('login-verifying')).toHaveTextContent(
    'Please wait',
  );
  expect(screen.getByLabelText('Six-digit code')).toHaveProp('editable', false);
  await fireEvent.press(busy);
  await fireEvent(screen.getByLabelText('Six-digit code'), 'submitEditing');
  await fireEvent.press(
    screen.getByRole('button', { name: 'Resend code (60s)' }),
  );

  await act(async () => pending.resolve({ data: { token: 't' }, error: null }));

  expect(authClient.phoneNumber.verify).toHaveBeenCalledTimes(1);
  expect(authClient.phoneNumber.sendOtp).toHaveBeenCalledTimes(1);
  expect(refresh).toHaveBeenCalledTimes(1);
  jest.mocked(useAuth).mockReturnValue(authValue);
});

it.each([
  [
    'the session cannot be fetched',
    async () => Promise.reject(new TypeError('Network request failed')),
  ],
  ['no session is found', async () => false],
])(
  'should retry only the session fetch when %s after the code was accepted',
  async (_case, failure) => {
    const refresh = jest
      .fn<() => Promise<boolean>>()
      .mockImplementationOnce(failure)
      .mockResolvedValueOnce(true);
    jest.mocked(useAuth).mockReturnValue({ ...authValue, refresh });
    await openCodeStep();
    await waitFor(() =>
      expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Six-digit code'),
      '482619',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));

    await waitFor(() =>
      expect(screen.getByTestId('login-session-error')).toHaveTextContent(
        'Your code was accepted, but signing in could not finish. Retry to continue.',
      ),
    );
    expect(screen.queryByLabelText('Six-digit code')).toBeNull();
    const retry = screen.getByTestId('login-session-retry');
    await act(async () => {
      void fireEvent.press(retry);
      void fireEvent.press(retry);
    });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    expect(authClient.phoneNumber.verify).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Your code was accepted, but signing in could not finish. Retry to continue.',
        ),
      ).toBeNull(),
    );
    jest.mocked(useAuth).mockReturnValue(authValue);
  },
);

it('should submit a complete code with Enter and ignore Enter for a partial one', async () => {
  await openCodeStep();
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '4826');
  await fireEvent(screen.getByLabelText('Six-digit code'), 'submitEditing');
  expect(authClient.phoneNumber.verify).not.toHaveBeenCalled();

  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '482619');
  await fireEvent(screen.getByLabelText('Six-digit code'), 'submitEditing');

  await waitFor(() =>
    expect(authClient.phoneNumber.verify).toHaveBeenCalledWith({
      phoneNumber: '+85291234528',
      code: '482619',
    }),
  );
});

it.each([
  [
    'an incorrect code',
    { code: 'OTP_INVALID', message: 'Invalid verification code' },
    'That code is not correct. Check it and try again.',
  ],
  [
    'an unauthorized status',
    { status: 401, statusText: 'Unauthorized' },
    'That code is not correct. Check it and try again.',
  ],
  [
    'too many attempts',
    { code: 'RATE_LIMITED', message: 'Too many verification attempts' },
    'Too many attempts. Request a new code.',
  ],
  [
    'a server failure',
    { status: 503, statusText: 'Service Unavailable' },
    'Verification could not finish. Check your connection and try again.',
  ],
])('should keep the code and explain %s', async (_case, error, message) => {
  jest.mocked(authClient.phoneNumber.verify).mockResolvedValueOnce({
    data: null,
    error,
  });
  await openCodeStep();
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '482619');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));

  await waitFor(() =>
    expect(screen.getByTestId('login-verify-error')).toHaveTextContent(message),
  );
  expect(screen.getByLabelText('Six-digit code')).toHaveProp('value', '482619');
  expect(screen.getByRole('button', { name: 'Verify code' })).toBeEnabled();
});

it('should keep the code when the verification request cannot be sent', async () => {
  jest
    .mocked(authClient.phoneNumber.verify)
    .mockRejectedValueOnce(new TypeError('Network request failed'));
  await openCodeStep();
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );
  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '482619');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));

  await waitFor(() =>
    expect(screen.getByTestId('login-verify-error')).toHaveTextContent(
      'Verification could not finish. Check your connection and try again.',
    ),
  );
  expect(screen.getByLabelText('Six-digit code')).toHaveProp('value', '482619');
});

it('should keep the number through an expired code and a new request', async () => {
  jest.useFakeTimers();
  try {
    jest.mocked(authClient.phoneNumber.verify).mockResolvedValueOnce({
      data: null,
      error: { status: 410, statusText: 'Gone' },
    });
    await openCodeStep();
    await waitFor(() =>
      expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
    );
    await fireEvent.changeText(
      screen.getByLabelText('Six-digit code'),
      '482619',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
    await waitFor(() =>
      expect(screen.getByTestId('login-expired')).toBeTruthy(),
    );
    expect(screen.queryByTestId('login-verify-error')).toBeNull();
    await act(async () => jest.advanceTimersByTime(resendCooldownMilliseconds));

    await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));

    await waitFor(() =>
      expect(screen.queryByTestId('login-expired')).toBeNull(),
    );
    expect(screen.getByTestId('login-masked-phone')).toHaveTextContent(
      'WhatsApp number +852 9••• ••28',
    );
    expect(screen.getByLabelText('Six-digit code')).toHaveProp('value', '');
    expect(authClient.phoneNumber.sendOtp).toHaveBeenLastCalledWith({
      phoneNumber: '+85291234528',
    });
  } finally {
    jest.useRealTimers();
  }
});
