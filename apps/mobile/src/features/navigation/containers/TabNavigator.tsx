import { Tabs } from 'expo-router';

import { StyleSheet, Text, View } from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { IconName } from '@antica/ui';

import type { MessageKey } from '../../../i18n/messages';

const tabBar = theme.state.tabBar;

const layout = StyleSheet.create({
  bar: {
    backgroundColor: tabBar.bg,
    borderTopColor: tabBar.borderTop.color,
    borderTopWidth: tabBar.borderTop.width,
    // the bar is painted once: a navigator elevation shadow shows through its translucent fill as a band
    elevation: 0,
    shadowOpacity: 0,
  },
  item: { gap: theme.space[2] },
  pill: {
    width: tabBar.pill.width,
    height: tabBar.pill.height,
    borderRadius: tabBar.pill.radius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  current: { backgroundColor: tabBar.pill.bg },
  // the sheet's 12 sp label at 1.6 line height, 2 dp under the pill (the item gap); Noto Sans TC
  // sits its glyphs about 3 dp higher in the line than the sheet's face, so the label drops by that
  label: { fontSize: tabBar.fontSize, lineHeight: 19, marginTop: 3 },
  labelDefault: {
    color: tabBar.default.fg,
    ...theme.font.face('sans', tabBar.default.weight),
  },
  labelCurrent: {
    color: tabBar.current.fg,
    ...theme.font.face('sans', tabBar.current.weight),
  },
});

/** the four v5 tabs in display order, with their route, label and icon */
const tabs: ReadonlyArray<{
  route: string;
  label: MessageKey;
  icon: IconName;
}> = [
  { route: 'today', label: 'tabToday', icon: 'today' },
  { route: 'collection', label: 'tabCollection', icon: 'grid' },
  { route: 'knowledge', label: 'tabKnowledge', icon: 'book' },
  { route: 'me', label: 'tabMe', icon: 'user' },
];

/**
 * the v5 tab shell 今天 · 藏品 · 知識 · 我: each icon sits in a pill that fills for the current tab,
 * with the label beneath it
 * @returns the bottom tabs
 */
export const TabNavigator: FC = () => {
  const { t } = useLocale();
  // the bar keeps its 64 dp above the system gesture area
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [
          layout.bar,
          {
            // the sheet centres pill and label in the 64 dp bar, above the gesture inset
            height: tabBar.height + bottom,
            paddingBottom: bottom,
          },
        ],
        tabBarItemStyle: layout.item,
      }}>
      {tabs.map(({ route, label, icon }) => (
        <Tabs.Screen
          key={route}
          name={route}
          options={{
            title: t(label),
            tabBarButtonTestID: `tab-${route}`,
            tabBarIcon: ({ focused }) => (
              <View style={[layout.pill, focused && layout.current]}>
                <Icon
                  name={icon}
                  color={focused ? tabBar.current.fg : tabBar.default.fg}
                />
              </View>
            ),
            tabBarLabel: ({ focused }) => (
              <Text
                style={[
                  layout.label,
                  focused ? layout.labelCurrent : layout.labelDefault,
                ]}>
                {t(label)}
              </Text>
            ),
          }}
        />
      ))}
    </Tabs>
  );
};
