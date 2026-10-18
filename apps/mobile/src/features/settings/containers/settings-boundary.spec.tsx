import { describe, expect, it, jest } from '@jest/globals';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen, waitFor } from '@testing-library/react-native';

import { Text } from 'react-native';

import { ApiTransport } from '@antica/client';

import PrivateLayout from '../../../app/(private)/_layout';
import SettingsRoute from '../../../app/(private)/settings';
import IndexRoute from '../../../app/index';
import LanguageSettingsRoute from '../../../app/settings/language';
import { interfaceLanguagePreferences } from '../../../i18n/preferences';
import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { useAuth } from '../../../providers/AuthProvider';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { SessionNavigator } from '../../auth/containers/SessionNavigator';

import { renderRouter } from 'expo-router/testing-library';

import type { FC, PropsWithChildren, ReactElement } from 'react';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

const signedOut = {
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

const LoginScene = (): ReactElement => <Text>Login route</Text>;

const Device: FC<PropsWithChildren> = ({ children }) => (
  <QueryClientProvider client={new QueryClient()}>
    <LocaleProvider preferences={savedPreferences('en')}>
      {children}
    </LocaleProvider>
  </QueryClientProvider>
);

/**
 * renders the real session navigator and settings routes at a URL
 * @param initialUrl URL the app opens at
 * @returns the pending render, which also reports the current pathname
 */
function openAt(initialUrl: string): ReturnType<typeof renderRouter> {
  return renderRouter(
    {
      '_layout': (): ReactElement => <SessionNavigator />,
      'index': IndexRoute,
      'login': LoginScene,
      '(private)/_layout': PrivateLayout,
      '(private)/settings/index': SettingsRoute,
      'settings/language': LanguageSettingsRoute,
    },
    { initialUrl, wrapper: Device },
  );
}

describe('Settings before sign-in', () => {
  it('should send a signed-out collector away from the Settings home', async () => {
    jest.mocked(useAuth).mockReturnValue({
      ...signedOut,
      phone: '+85212345678',
    });

    const view = openAt('/settings');
    await view;

    await waitFor(() => expect(view.getPathname()).toBe('/login'));
    expect(screen.getByText('Login route')).toBeTruthy();
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByText(/5678/)).toBeNull();
  });

  it('should offer only the language choices to a signed-out collector', async () => {
    jest.mocked(useAuth).mockReturnValue({
      ...signedOut,
      phone: '+85212345678',
    });

    const view = openAt('/settings/language');
    await view;

    await waitFor(() =>
      expect(
        screen.getByRole('header', { name: 'Language / 語言' }),
      ).toBeTruthy(),
    );
    expect(view.getPathname()).toBe('/settings/language');
    expect(
      screen.getAllByRole('radio').map((option) => option.props.testID),
    ).toEqual(
      interfaceLanguagePreferences.map((choice) => `language-option-${choice}`),
    );
    expect(screen.queryByText('Sign out')).toBeNull();
    expect(screen.queryByText('Session')).toBeNull();
    expect(screen.queryByText(/5678/)).toBeNull();
  });

  it('should show the Settings home to a signed-in collector', async () => {
    jest.mocked(useAuth).mockReturnValue({
      ...signedOut,
      authenticated: true,
      phone: '+85212345678',
    });

    const view = openAt('/settings');
    await view;

    await waitFor(() =>
      expect(screen.getByRole('header', { name: 'Settings' })).toBeTruthy(),
    );
    expect(view.getPathname()).toBe('/settings');
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
  });
});
