import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StatusBar } from 'react-native';

import { colors } from '@antica/ui';

import { AskSheetContainer } from '../features/assistant/containers/AskSheetContainer';
import { SessionNavigator } from '../features/auth/containers/SessionNavigator';
import { DevLocaleLink } from '../i18n/DevLocaleLink';
import { AskAssistantProvider } from '../providers/AskAssistantProvider';
import { AuthProvider } from '../providers/AuthProvider';
import { LocaleProvider } from '../providers/LocaleProvider';

import type { ReactElement } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout(): ReactElement {
  return (
    <QueryClientProvider client={queryClient}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
      <LocaleProvider>
        {/* release bundles drop the development-only language link */}
        {__DEV__ ? <DevLocaleLink /> : null}
        <AuthProvider>
          {/* one ask sheet serves the assistant pill in every screen's top bar */}
          <AskAssistantProvider>
            <SessionNavigator />
            <AskSheetContainer />
          </AskAssistantProvider>
        </AuthProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
