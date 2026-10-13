import { Tabs } from 'expo-router';

import { colors } from '@antica/ui';

import { useLocale } from '../../../locale';

import type { ReactElement } from 'react';

export default function TabLayout(): ReactElement {
  const { t } = useLocale();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.jade,
        tabBarInactiveTintColor: colors.muted,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarLabelPosition: 'beside-icon',
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          minHeight: 64,
        },
        tabBarLabelStyle: { fontSize: 14, marginHorizontal: 0 },
      }}>
      <Tabs.Screen name="collection" options={{ title: t('collection') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tasks') }} />
      <Tabs.Screen name="knowledge" options={{ title: t('knowledge') }} />
      <Tabs.Screen name="research" options={{ title: t('research') }} />
    </Tabs>
  );
}
