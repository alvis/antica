import { Pressable, Text } from 'react-native';

import { styles } from '@antica/ui';

import type { FC } from 'react';

/** properties for an action of the message area */
export type MessageButtonProps = {
  label: string;
  /** stable automation identifier */
  testID: string;
  /** action handler; the button is disabled while it is absent */
  onPress?: () => void;
  secondary?: boolean;
};

/**
 * renders a 48 dp action that exposes a stable automation identifier
 * @param props button properties
 * @param props.label visible and spoken action label
 * @param props.testID stable automation identifier
 * @param props.onPress action handler, absent while the action is unavailable
 * @param props.secondary uses the outlined presentation when true
 * @returns the native button
 */
export const MessageButton: FC<MessageButtonProps> = ({
  label,
  testID,
  onPress,
  secondary,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: !onPress }}
    disabled={!onPress}
    onPress={onPress}
    style={[
      secondary ? styles.secondaryButton : styles.button,
      !onPress && { opacity: 0.5 },
    ]}>
    <Text style={secondary ? styles.secondaryButtonText : styles.buttonText}>
      {label}
    </Text>
  </Pressable>
);
