import { Pressable, Text } from 'react-native';

import { styles } from '@antica/ui';

import type { FC } from 'react';

export type FreshnessOptionProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

export const FreshnessOption: FC<FreshnessOptionProps> = ({
  label,
  selected,
  onPress,
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected }}
    onPress={onPress}
    style={selected ? styles.button : styles.secondaryButton}>
    <Text style={selected ? styles.buttonText : styles.secondaryButtonText}>
      {label}
    </Text>
  </Pressable>
);
