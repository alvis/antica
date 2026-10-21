import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { StatusBar, View } from 'react-native';

import { colors } from '@antica/ui';

import { AskSheetContainer } from '../features/assistant/containers/AskSheetContainer';
import { SessionNavigator } from '../features/auth/containers/SessionNavigator';
import { useBundledFaces } from '../hooks/useBundledFaces';
import { DevLocaleLink } from '../i18n/DevLocaleLink';
import { AskAssistantProvider } from '../providers/AskAssistantProvider';
import { AuthProvider } from '../providers/AuthProvider';
import { LocaleProvider } from '../providers/LocaleProvider';

import type { ReactElement } from 'react';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000 } },
});

export default function RootLayout(): ReactElement {
  // Android draws only the page colour until its Traditional Chinese faces are in, so no text
  // renders in the device locale's fallback forms first and no blank frame flashes after the splash
  const facesReady = useBundledFaces();
  if (!facesReady) {
    return <View style={{ flex: 1, backgroundColor: colors.canvas }} />;
  }

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
