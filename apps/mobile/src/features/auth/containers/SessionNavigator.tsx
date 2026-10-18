import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { styles } from '@antica/ui';

import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

const layout = StyleSheet.create({
  fill: { flex: 1 },
  center: { justifyContent: 'center' },
});

/**
 * root navigator that always mounts and exposes private routes only to an authenticated collector
 *
 * Private routes stay reachable while the session restores, so a cold-start deep link keeps its
 * destination. Until the session resolves, an opaque cover hides the screens beneath it; once
 * the session resolves without a collector, private URLs fall back to the index route, which
 * redirects to /login.
 * @returns the root stack under the session-restore cover
 */
export const SessionNavigator: FC = () => {
  const { authenticated, loading } = useAuth();

  return (
    <View style={layout.fill}>
      <View style={layout.fill} aria-hidden={loading}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={authenticated || loading}>
            <Stack.Screen name="(private)" />
          </Stack.Protected>
        </Stack>
      </View>
      {loading ? (
        <View style={[styles.screen, StyleSheet.absoluteFill, layout.center]}>
          <ActivityIndicator accessibilityLabel="Loading session" />
        </View>
      ) : null}
    </View>
  );
};
