import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StatusBar } from 'react-native';

import { colors } from '@antica/ui';

import { SessionNavigator } from '../features/auth/containers/SessionNavigator';
import { LocaleProvider } from '../i18n/LocaleProvider';
import { AuthProvider } from '../providers/AuthProvider';

import type { ReactElement } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
      <LocaleProvider>
        <AuthProvider>
          <SessionNavigator />
        </AuthProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
