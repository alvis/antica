import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import type { FC } from 'react';

/** properties for a primary action that shows and announces its own work */
export type BusyButtonProps = {
  /** visible and spoken label; callers pass the in-progress wording while busy */
  label: string;
  onPress: () => void;
  /** shows a spinner, blocks presses, and announces the busy state */
  busy?: boolean;
  disabled?: boolean;
  /** uses the outlined presentation when true */
  secondary?: boolean;
  /** stable automation identifier for native tests and end-to-end flows */
  testID?: string;
};

/**
 * renders the shared button look with a spinner while its action runs
 * @param props button properties
 * @param props.label visible and spoken label
 * @param props.onPress action handler, never called while busy or disabled
 * @param props.busy whether the action is running
 * @param props.disabled whether the action is unavailable
 * @param props.secondary whether to use the outlined presentation
 * @param props.testID stable automation identifier
 * @returns the native button
 */
export const BusyButton: FC<BusyButtonProps> = ({
  label,
  onPress,
  busy = false,
  disabled = false,
  secondary = false,
  testID,
}) => {
  const blocked = busy || disabled;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: blocked }}
      // react-native-web reads only the ARIA prop for the busy state
      aria-busy={busy}
      disabled={blocked}
      onPress={onPress}
      style={[
        secondary ? styles.secondaryButton : styles.button,
        blocked && { opacity: 0.6 },
      ]}>
      <View style={[styles.row, { justifyContent: 'center' }]}>
        {busy && (
          <ActivityIndicator
            testID={testID && `${testID}-spinner`}
            color={secondary ? colors.jade : colors.card}
          />
        )}
        <Text
          style={secondary ? styles.secondaryButtonText : styles.buttonText}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
};
