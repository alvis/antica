import { Text, TextInput, View } from 'react-native';

import { styles } from './theme.js';

import type { FC } from 'react';
import type { KeyboardTypeOptions } from 'react-native';

/** properties for a labeled controlled native text field */
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
 * renders a labeled native text input with collection field styling
 * @param root0 field properties
 * @param root0.label visible and spoken field label
 * @param root0.value current controlled value
 * @param root0.onChangeText receives edited text
 * @param root0.keyboardType native keyboard layout
 * @param root0.multiline allows multiple lines when true
 * @param root0.editable allows editing when true
 * @param root0.autoComplete native autofill hint
 * @returns the labeled native input
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
