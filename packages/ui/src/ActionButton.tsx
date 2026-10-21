import { ActivityIndicator, Pressable, Text } from 'react-native';

import { Icon } from './Icon.js';
import { styles, theme } from './theme.js';

import type { FC } from 'react';

import type { IconName } from './Icon.js';

/** properties for an accessible collection action */
export type ActionButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondary?: boolean;
  /** shows a spinner and blocks presses while the action runs */
  loading?: boolean;
  /** design icon shown before the label, such as the camera on 拍攝新藏品 */
  icon?: IconName;
  /** stable automation identifier for native tests and end-to-end flows */
  testID?: string;
};

const button = theme.state.button;

/**
 * renders an accessible action in the sheet's default, pressed, disabled and loading states
 * @param root0 button properties
 * @param root0.label visible and spoken action label
 * @param root0.onPress action handler
 * @param root0.disabled prevents interaction when true
 * @param root0.secondary uses the outlined presentation when true
 * @param root0.loading shows progress and prevents interaction when true
 * @param root0.icon design icon before the label
 * @param root0.testID stable automation identifier
 * @returns the native button
 */
export const ActionButton: FC<ActionButtonProps> = ({
  label,
  onPress,
  disabled,
  secondary,
  loading,
  icon,
  testID,
}) => {
  const blocked = Boolean(disabled) || Boolean(loading);
  const tone = secondary ? button.secondary : button.primary;
  const resting = disabled ? tone.disabled : tone.default;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      // busy appears only while loading, so the resting state stays { disabled }
      accessibilityState={
        loading ? { disabled: blocked, busy: true } : { disabled: blocked }
      }
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [
        secondary ? styles.secondaryButton : styles.button,
        { backgroundColor: resting.bg },
        pressed && {
          backgroundColor: tone.pressed.bg,
          transform: [{ scale: theme.motion.press.scale }],
        },
      ]}>
      {loading && (
        <ActivityIndicator size={button.spinner} color={resting.fg} />
      )}
      {icon && !loading && <Icon name={icon} color={resting.fg} />}
      <Text
        style={[
          secondary ? styles.secondaryButtonText : styles.buttonText,
          { color: resting.fg },
        ]}>
        {label}
      </Text>
    </Pressable>
  );
};
