import { expect, it, jest } from '@jest/globals';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';

import { authClient, useAuth } from '../../../providers/AuthProvider';

import { authValue, openCodeStep, renderLogin } from './login.spec.fixtures';

import type { SendResult } from './login.spec.fixtures';

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

it('should show the masked number and a sending status until the request answers', async () => {
  const pending = Promise.withResolvers<SendResult>();
  jest
    .mocked(authClient.phoneNumber.sendOtp)
    .mockReturnValueOnce(pending.promise);
  await openCodeStep();

  expect(screen.getByTestId('login-masked-phone')).toHaveTextContent(
    'WhatsApp number +852 9••• ••28',
  );
  expect(screen.getByTestId('login-delivery-sending')).toHaveTextContent(
    'Sending the code…',
  );
  expect(screen.getByRole('button', { name: 'Resend code' })).toBeDisabled();

  await act(async () =>
    pending.resolve({ data: { status: true }, error: null }),
  );

  expect(screen.getByTestId('login-masked-phone')).toHaveTextContent(
    'WhatsApp number +852 9••• ••28',
  );
  expect(screen.getByTestId('login-delivery-sent')).toHaveTextContent(
    'If this number is permitted, a code was sent via WhatsApp',
  );
});

it('should send one code however often Continue is pressed', async () => {
  const pending = Promise.withResolvers<SendResult>();
  jest
    .mocked(authClient.phoneNumber.sendOtp)
    .mockReturnValueOnce(pending.promise);
  await renderLogin();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Sign in with WhatsApp' }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Authorized phone number'),
    '+85291234528',
  );
  const proceed = screen.getByRole('button', { name: 'Continue' });
  await act(async () => {
    void fireEvent.press(proceed);
    void fireEvent.press(proceed);
  });
  await act(async () =>
    pending.resolve({ data: { status: true }, error: null }),
  );

  expect(authClient.phoneNumber.sendOtp).toHaveBeenCalledTimes(1);
});

it('should report a rate limit and count down before another request', async () => {
  jest.mocked(authClient.phoneNumber.sendOtp).mockResolvedValueOnce({
    data: null,
    error: { status: 429, statusText: 'Too Many Requests' },
  });
  await openCodeStep();

  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-rate-limited')).toHaveTextContent(
      'Too many code requests. Wait a moment, then request a new code.',
    ),
  );
  expect(
    screen.getByRole('button', { name: 'Resend code (60s)' }),
  ).toBeDisabled();
});

it('should report an unreachable service as a failure with a retry', async () => {
  jest
    .mocked(authClient.phoneNumber.sendOtp)
    .mockRejectedValueOnce(new TypeError('Network request failed'));
  await openCodeStep();

  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-failed')).toBeTruthy(),
  );
  expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
});

it('should return to number entry from the code step', async () => {
  await openCodeStep();
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Change number' }));

  expect(screen.getByLabelText('Authorized phone number')).toHaveProp(
    'value',
    '+85291234528',
  );
  expect(screen.queryByTestId('login-code')).toBeNull();
});

it('should ignore a late reply for a number the collector has since changed', async () => {
  const stale = Promise.withResolvers<SendResult>();
  jest
    .mocked(authClient.phoneNumber.sendOtp)
    .mockReturnValueOnce(stale.promise);
  await openCodeStep();
  await fireEvent.press(screen.getByRole('button', { name: 'Change number' }));
  await fireEvent.changeText(
    screen.getByLabelText('Authorized phone number'),
    '+85261234577',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );

  // the first number's request is refused only after the second one was sent
  await act(async () =>
    stale.resolve({
      data: null,
      error: { status: 429, statusText: 'Too Many Requests' },
    }),
  );

  expect(screen.getByTestId('login-delivery-sent')).toBeTruthy();
  expect(screen.getByTestId('login-masked-phone')).toHaveTextContent(
    'WhatsApp number +852 6••• ••77',
  );
  expect(authClient.phoneNumber.sendOtp).toHaveBeenLastCalledWith({
    phoneNumber: '+85261234577',
  });
  await fireEvent.changeText(screen.getByLabelText('Six-digit code'), '482619');
  await fireEvent.press(screen.getByRole('button', { name: 'Verify code' }));
  await waitFor(() =>
    expect(authClient.phoneNumber.verify).toHaveBeenCalledWith({
      phoneNumber: '+85261234577',
      code: '482619',
    }),
  );
});

it('should ignore a late network failure for a number the collector has since changed', async () => {
  const stale = Promise.withResolvers<SendResult>();
  jest
    .mocked(authClient.phoneNumber.sendOtp)
    .mockReturnValueOnce(stale.promise);
  await openCodeStep();
  await fireEvent.press(screen.getByRole('button', { name: 'Change number' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await waitFor(() =>
    expect(screen.getByTestId('login-delivery-sent')).toBeTruthy(),
  );

  await act(async () => stale.reject(new TypeError('Network request failed')));

  expect(screen.getByTestId('login-delivery-sent')).toBeTruthy();
  expect(authClient.phoneNumber.sendOtp).toHaveBeenCalledTimes(2);
});
