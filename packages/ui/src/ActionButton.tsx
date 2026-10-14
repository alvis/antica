import { Pressable, Text } from 'react-native';

import { styles } from './theme.js';

import type { FC } from 'react';

/** properties for an accessible collection action */
export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
};

/**
 * renders an accessible action with primary and secondary presentation
 * @param root0 button properties
 * @param root0.label visible and spoken action label
 * @param root0.onPress action handler
 * @param root0.disabled prevents interaction when true
 * @param root0.secondary uses the outlined presentation when true
 * @returns the native button
 */
export const ActionButton: FC<ActionButtonProps> = ({
  label,
  onPress,
  disabled,
  secondary,
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled}
    onPress={onPress}
    style={[
      secondary ? styles.secondaryButton : styles.button,
      disabled && { opacity: 0.5 },
    ]}>
    <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>
      {label}
    </Text>
  </Pressable>
);
