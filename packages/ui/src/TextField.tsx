import { Text, TextInput, View } from 'react-native';

import { styles } from './theme.js';

import type { FC } from 'react';
import type { KeyboardTypeOptions } from 'react-native';

export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  editable?: boolean;
  autoComplete?: 'one-time-code' | 'tel' | 'off';
};

/**
 * Labelled native text input with Antica field styling.
 * @param root0 Field properties.
 * @param root0.label Visible and spoken field label.
 * @param root0.value Current controlled value.
 * @param root0.onChangeText Receives edited text.
 * @param root0.keyboardType Native keyboard layout.
 * @param root0.multiline Allows multiple lines when true.
 * @param root0.editable Allows editing when true.
 * @param root0.autoComplete Native autofill hint.
 * @returns The labelled native input.
 */
export const TextField: FC<TextFieldProps> = ({
  label,
  value,
  onChangeText,
  keyboardType,
  multiline,
  editable,
  autoComplete,
}) => (
  <View style={{ gap: 6 }}>
    <Text style={styles.label}>{label}</Text>
    <TextInput
      accessibilityLabel={label}
      autoComplete={autoComplete}
      keyboardType={keyboardType}
      multiline={multiline}
      editable={editable}
      onChangeText={onChangeText}
      style={styles.field}
      value={value}
    />
  </View>
);
