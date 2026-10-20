import { Pressable, View } from 'react-native';

import { styles, theme } from './theme.js';

import type { FC, PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** properties for a surface card, static or pressable */
export type CardProps = PropsWithChildren<{
  /** makes the whole card one button */
  onPress?: () => void;
  /** spoken name of the pressable card */
  accessibilityLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}>;

const card = theme.state.card;

/**
 * renders a raised paper card; with an action it becomes one button with a pressed tone
 * @param root0 card properties
 * @param root0.children card content
 * @param root0.onPress card action, if any
 * @param root0.accessibilityLabel spoken name of the action
 * @param root0.disabled prevents interaction when true
 * @param root0.style extra layout for the card
 * @param root0.testID stable automation identifier
 * @returns a raised surface, one pressable button when it has an action
 */
export const Card: FC<CardProps> = ({
  children,
  onPress,
  accessibilityLabel,
  disabled,
  style,
  testID,
}) =>
  onPress ? (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        style,
        pressed && { backgroundColor: card.pressed.bg },
      ]}>
      {children}
    </Pressable>
  ) : (
    <View testID={testID} style={[styles.card, style]}>
      {children}
    </View>
  );
