import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Stack } from 'expo-router';
import { StatusBar } from 'react-native';

import { colors } from '@antica/ui';

import { AuthProvider } from '../auth';
import { LocaleProvider } from '../locale';

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
          <Stack screenOptions={{ headerShown: false }} />
        </AuthProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
