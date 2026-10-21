import { useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { styles, theme } from './theme.js';

import type { FC, Ref } from 'react';
import type { KeyboardTypeOptions, StyleProp, TextStyle } from 'react-native';

/** properties for a labeled controlled native text field */
export type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  editable?: boolean;
  autoComplete?: 'one-time-code' | 'tel' | 'off';
  placeholder?: string;
  /** message shown under the field; its presence marks the field invalid */
  error?: string;
  onFocus?: () => void;
  onBlur?: () => void;
  /** stable automation identifier for the input */
  testID?: string;
  /** handle for focusing the input from elsewhere, such as a search button */
  inputRef?: Ref<TextInput>;
};

const input = theme.state.textInput;
const { ring } = theme.focus;
const { border } = input.default;

/**
 * layers the sheet's disabled, error and focus states over the resting X8 field
 * @param state which states apply
 * @param state.disabled the field cannot be edited
 * @param state.invalid the field carries an error message
 * @param state.focused the field has focus
 * @returns the input style
 */
function fieldStyle(state: {
  disabled: boolean;
  invalid: boolean;
  focused: boolean;
}): StyleProp<TextStyle> {
  return [
    styles.field,
    state.disabled && {
      backgroundColor: input.disabled.bg,
      color: input.disabled.fg,
    },
    state.invalid && {
      borderWidth: input.error.border.width,
      borderColor: input.error.border.color,
    },
    // the 2 dp ring replaces the 1 dp border, so the padding gives back the difference
    state.focused && {
      borderWidth: ring.width,
      borderColor: ring.color,
      paddingHorizontal: input.paddingH - (ring.width - border.width),
    },
  ];
}

/**
 * renders a labeled native input in the sheet's default, focused, error and disabled states
 * @param root0 field properties
 * @param root0.label visible and spoken field label
 * @param root0.value current controlled value
 * @param root0.onChangeText receives edited text
 * @param root0.keyboardType native keyboard layout
 * @param root0.multiline allows multiple lines when true
 * @param root0.editable allows editing unless false
 * @param root0.autoComplete native autofill hint
 * @param root0.placeholder hint shown while the field is empty
 * @param root0.error message that marks the field invalid
 * @param root0.onFocus called when the field gains focus
 * @param root0.onBlur called when the field loses focus
 * @param root0.testID stable automation identifier
 * @param root0.inputRef handle for focusing the input
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
  placeholder,
  error,
  onFocus,
  onBlur,
  testID,
  inputRef,
}) => {
  const [focused, setFocused] = useState(false);
  const disabled = editable === false;

  return (
    <View style={{ gap: theme.space[6] }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        testID={testID}
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        aria-invalid={Boolean(error)}
        autoComplete={autoComplete}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={input.placeholder}
        onChangeText={onChangeText}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        style={fieldStyle({ disabled, invalid: Boolean(error), focused })}
        value={value}
      />
      {error ? (
        <Text
          accessibilityRole="alert"
          style={[styles.label, { color: input.error.message }]}>
          {error}
        </Text>
      ) : null}
    </View>
  );
};
