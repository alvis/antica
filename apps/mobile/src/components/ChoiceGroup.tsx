import { Pressable, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import type { FC } from 'react';

/** one choice of a group */
export type Choice = {
  readonly value: string;
  readonly label: string;
  /** spoken label when it should say more than the visible one */
  readonly accessibilityLabel?: string;
  readonly testID: string;
};

/** properties for a group of single or multiple choices */
export type ChoiceGroupProps = {
  /** spoken name of the group */
  label: string;
  choices: readonly Choice[];
  /** values currently chosen */
  selected: readonly string[];
  /** whether several values may be chosen, as checkboxes, rather than one, as radios */
  multiple?: boolean;
  onToggle: (value: string) => void;
};

/**
 * renders choices as 48 dp buttons that say whether they are chosen
 * @param props group properties
 * @param props.label spoken name of the group
 * @param props.choices choices to show
 * @param props.selected chosen values
 * @param props.multiple uses checkboxes for several values instead of radios for one
 * @param props.onToggle receives the pressed value
 * @returns one pressable chip per choice, announced as radios or checkboxes
 */
export const ChoiceGroup: FC<ChoiceGroupProps> = ({
  label,
  choices,
  selected,
  multiple,
  onToggle,
}) => (
  <View
    accessibilityRole={multiple ? undefined : 'radiogroup'}
    accessibilityLabel={label}
    style={styles.row}>
    {choices.map((choice) => {
      const checked = selected.includes(choice.value);

      return (
        <Pressable
          key={choice.value}
          testID={choice.testID}
          accessibilityRole={multiple ? 'checkbox' : 'radio'}
          accessibilityLabel={choice.accessibilityLabel ?? choice.label}
          accessibilityState={{ checked }}
          onPress={() => onToggle(choice.value)}
          style={[
            styles.secondaryButton,
            { minWidth: 48 },
            checked && { backgroundColor: colors.jade },
          ]}>
          <Text
            style={[
              styles.secondaryButtonText,
              checked && { color: colors.card },
            ]}>
            {choice.label}
          </Text>
        </Pressable>
      );
    })}
  </View>
);
