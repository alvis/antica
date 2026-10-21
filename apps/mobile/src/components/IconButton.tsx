import { Pressable, StyleSheet } from 'react-native';

import { Icon, theme } from '@antica/ui';

import type { FC } from 'react';

import type { IconName } from '@antica/ui';

/** properties for a 48 dp round icon control, such as search in a top bar */
export type IconButtonProps = {
  icon: IconName;
  /** spoken name of the control */
  label: string;
  onPress: () => void;
  /** dark glass over photos */
  onPhoto?: boolean;
  testID?: string;
};

const layout = StyleSheet.create({
  button: {
    width: theme.size.iconButton,
    height: theme.size.iconButton,
    borderRadius: theme.size.iconButton / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: { backgroundColor: theme.color.photo.glass },
  pressed: { backgroundColor: theme.color.bg.sunken },
});

/**
 * renders a labelled 48 dp icon control; over photos it switches to dark glass
 * @param root0 control properties
 * @param root0.icon which icon
 * @param root0.label spoken name
 * @param root0.onPress action
 * @param root0.onPhoto whether it sits over a photo
 * @param root0.testID stable automation identifier
 * @returns the pressable icon
 */
export const IconButton: FC<IconButtonProps> = ({
  icon,
  label,
  onPress,
  onPhoto = false,
  testID,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={({ pressed }) => [
      layout.button,
      onPhoto && layout.glass,
      pressed && !onPhoto && layout.pressed,
    ]}>
    <Icon
      name={icon}
      color={onPhoto ? theme.color.photo.onPhoto : theme.color.text.primary}
    />
  </Pressable>
);
