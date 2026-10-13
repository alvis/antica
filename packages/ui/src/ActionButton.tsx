import { Pressable, Text } from 'react-native';

import { styles } from './theme.js';

import type { FC } from 'react';

export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
};

/**
 * Accessible Antica action with primary and secondary presentation.
 * @param root0 Button properties.
 * @param root0.label Visible and spoken action label.
 * @param root0.onPress Action handler.
 * @param root0.disabled Prevents interaction when true.
 * @param root0.secondary Uses the outlined presentation when true.
 * @returns The native button.
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
