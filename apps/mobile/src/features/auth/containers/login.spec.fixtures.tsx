import { fireEvent, render, screen } from '@testing-library/react-native';

import { ApiTransport } from '@antica/client';

import LoginRoute from '../../../app/login';
import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import type { authClient, useAuth } from '../../../providers/AuthProvider';

/** signed-out session used while the login route sends and verifies codes */
export const authValue = {
  api: new ApiTransport({
    baseUrl: 'https://api.example',
    session: { getCookie: async () => '', onUnauthorized: () => undefined },
  }),
  authenticated: false,
  loading: false,
  phone: null,
  userId: null,
  refresh: async () => true,
  signOut: async () => undefined,
  expire: () => undefined,
} satisfies ReturnType<typeof useAuth>;

/** result of a WhatsApp code request */
export type SendResult = Awaited<
  ReturnType<typeof authClient.phoneNumber.sendOtp>
>;

/** result of a code verification */
export type VerifyResult = Awaited<
  ReturnType<typeof authClient.phoneNumber.verify>
>;

/**
 * renders the login route in English
 * @returns resolves once the route has rendered
 */
export async function renderLogin(): Promise<void> {
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <LoginRoute />
    </LocaleProvider>,
  );
}

/**
 * renders the login route in English and moves to the code step for a Hong Kong number
 * @returns resolves once Continue has been pressed
 */
export async function openCodeStep(): Promise<void> {
  await renderLogin();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Sign in with WhatsApp' }),
  );
  await fireEvent.changeText(
    screen.getByLabelText('Authorized phone number'),
    '+85291234528',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
}
