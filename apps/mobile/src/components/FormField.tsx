import { Text, TextInput, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import type { FC } from 'react';
import type { KeyboardTypeOptions } from 'react-native';

/** properties for a labelled text input that can show a validation error */
export type FormFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  /** stable automation identifier of the input */
  testID: string;
  /** format or meaning of the value, shown under the label and spoken as a hint */
  hint?: string;
  /** translated validation error; announced when it appears */
  error?: string;
  keyboardType?: KeyboardTypeOptions;
  multiline?: boolean;
  autoCapitalize?: 'none' | 'characters' | 'sentences';
};

/**
 * renders a labelled text input whose error is shown beside it and announced
 * @param props field properties
 * @param props.label visible and spoken label
 * @param props.value current text
 * @param props.onChangeText receives edited text
 * @param props.testID automation identifier of the input
 * @param props.hint format or meaning of the value
 * @param props.error translated validation error
 * @param props.keyboardType native keyboard layout
 * @param props.multiline allows several lines
 * @param props.autoCapitalize native capitalization
 * @returns the labelled input
 */
export const FormField: FC<FormFieldProps> = ({
  label,
  value,
  onChangeText,
  testID,
  hint,
  error,
  keyboardType,
  multiline,
  autoCapitalize,
}) => (
  <View style={{ gap: 6 }}>
    <Text style={styles.label}>{label}</Text>
    {hint && <Text style={styles.secondary}>{hint}</Text>}
    <TextInput
      testID={testID}
      accessibilityLabel={label}
      accessibilityHint={[hint, error].filter(Boolean).join('. ') || undefined}
      autoCapitalize={autoCapitalize}
      keyboardType={keyboardType}
      multiline={multiline}
      onChangeText={onChangeText}
      style={[styles.field, error && { borderColor: colors.error }]}
      value={value}
    />
    <FieldError testID={`${testID}-error`} error={error} />
  </View>
);

/** properties for a validation error that belongs to one field or a group of fields */
export type FieldErrorProps = { testID: string; error?: string };

/**
 * shows a validation error and announces it when it appears
 * @param props error properties
 * @param props.testID automation identifier of the error
 * @param props.error translated error, if any
 * @returns the announced error, or nothing without one
 */
export const FieldError: FC<FieldErrorProps> = ({ testID, error }) =>
  error ? (
    <Text
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={styles.error}>
      {error}
    </Text>
  ) : null;
