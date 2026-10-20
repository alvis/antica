import { Tabs } from 'expo-router';

import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { MessageKey } from '../../../i18n/messages';

const tabBar = theme.state.tabBar;

const layout = StyleSheet.create({
  bar: {
    backgroundColor: tabBar.bg,
    borderTopColor: tabBar.borderTop.color,
    borderTopWidth: tabBar.borderTop.width,
    minHeight: tabBar.height,
  },
  pill: {
    minWidth: tabBar.pill.width,
    height: tabBar.pill.height,
    borderRadius: tabBar.pill.radius,
    paddingHorizontal: theme.space[12],
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: theme.font.family.sans, fontSize: 14 },
});

/** the four v5 tabs in display order, with their route and label */
const tabs: ReadonlyArray<{ route: string; label: MessageKey }> = [
  { route: 'today', label: 'tabToday' },
  { route: 'collection', label: 'tabCollection' },
  { route: 'knowledge', label: 'tabKnowledge' },
  { route: 'me', label: 'tabMe' },
];

/**
 * the v5 tab shell 今天 · 藏品 · 知識 · 我; the current tab sits in the sheet's pill
 * @returns the bottom tabs
 */
export const TabNavigator: FC = () => {
  const { t } = useLocale();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarIcon: () => null,
        tabBarIconStyle: { display: 'none' },
        tabBarStyle: layout.bar,
      }}>
      {tabs.map(({ route, label }) => (
        <Tabs.Screen
          key={route}
          name={route}
          options={{
            title: t(label),
            tabBarButtonTestID: `tab-${route}`,
            tabBarLabel: ({ focused }) => (
              <View
                style={[
                  layout.pill,
                  focused && { backgroundColor: tabBar.pill.bg },
                ]}>
                <Text
                  style={[
                    layout.label,
                    focused
                      ? { color: tabBar.current.fg, fontWeight: '700' }
                      : { color: tabBar.default.fg, fontWeight: '500' },
                  ]}>
                  {t(label)}
                </Text>
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
};
