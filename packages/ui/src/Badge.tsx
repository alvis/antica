import { StyleSheet, Text, View } from 'react-native';

import { theme } from './theme.js';

import type { FC } from 'react';

/** the sheet's badge tones */
export type BadgeTone =
  'accent' | 'warning' | 'danger' | 'neutral' | 'assistant' | 'onPhoto';

/** properties for a short status badge */
export type BadgeProps = {
  label: string;
  tone?: BadgeTone;
  testID?: string;
};

const badge = theme.state.badge;

const layout = StyleSheet.create({
  frame: {
    alignSelf: 'flex-start',
    minHeight: badge.height,
    paddingHorizontal: badge.paddingH,
    borderRadius: badge.radius,
    justifyContent: 'center',
  },
  text: theme.type.micro,
});

/**
 * renders a short status label, such as 2 項修改待確認 or 需要補拍
 * @param root0 badge properties
 * @param root0.label visible text
 * @param root0.tone colour role
 * @param root0.testID stable automation identifier
 * @returns the label on its tone colour
 */
export const Badge: FC<BadgeProps> = ({ label, tone = 'neutral', testID }) => (
  <View
    testID={testID}
    style={[layout.frame, { backgroundColor: badge[tone].bg }]}>
    <Text style={[layout.text, { color: badge[tone].fg }]}>{label}</Text>
  </View>
);
