import { useRouter } from 'expo-router';

import { Pressable, StyleSheet, Text } from 'react-native';

import { colors } from '@antica/ui';

import { useLocale } from '../providers/LocaleProvider';

import type { FC } from 'react';

const layout = StyleSheet.create({
  action: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // the text variation selector keeps the gear a monochrome glyph rather than an emoji
  gear: { color: colors.jade, fontSize: 26 },
});

/**
 * opens Settings from a main-tab header as a stack screen above the tabs, so returning keeps the tab's state
 * @returns the labelled gear action
 */
export const SettingsAction: FC = () => {
  const router = useRouter();
  const { t } = useLocale();

  return (
    <Pressable
      testID="open-settings"
      accessibilityRole="button"
      accessibilityLabel={t('settings')}
      onPress={() => router.push('/settings')}
      style={layout.action}>
      <Text
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={layout.gear}>
        {'⚙︎'}
      </Text>
    </Pressable>
  );
};
