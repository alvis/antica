import { Tabs } from 'expo-router';

import { colors } from '@antica/ui';

import { useLocale } from '../../../i18n/LocaleProvider';

import type { FC } from 'react';

export const TabNavigator: FC = () => {
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
        tabBarLabelStyle: { fontSize: 14, marginEnd: -5, marginStart: -5 },
      }}>
      <Tabs.Screen name="collection" options={{ title: t('collection') }} />
      <Tabs.Screen name="tasks" options={{ title: t('tasks') }} />
      <Tabs.Screen name="knowledge" options={{ title: t('knowledge') }} />
      <Tabs.Screen name="research" options={{ title: t('research') }} />
    </Tabs>
  );
};
