import { Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { useLocale } from '../providers/LocaleProvider';
import { formatFieldValue } from '../utils/field-value';

import type { FC } from 'react';

import type { TextStyle, ViewStyle } from 'react-native';

import type { FieldDisplayValue } from '../utils/field-value';

const inlineRow: ViewStyle = {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 12,
};

const inlineValue: TextStyle = { flexShrink: 1, textAlign: 'right' };

/** properties for one labelled record field value */
export type FieldValueProps = {
  /** what the value is, such as "Before" or "Your edit" */
  label: string;
  /** field value, with identifiers already replaced by their labels */
  value: FieldDisplayValue;
  /** shows the value as replaced, for a value a change supersedes */
  superseded?: boolean;
  /** stable automation identifier of the value text */
  testID?: string;
  /** places the label beside a short value on one row, instead of above it */
  inline?: boolean;
};

/**
 * shows a labelled record field value formatted the same way on every screen
 * @param props value properties
 * @param props.label what the value is
 * @param props.value field value with identifiers replaced by labels
 * @param props.superseded strikes the value through when a change replaces it
 * @param props.testID automation identifier of the value text
 * @param props.inline places the label beside the value on one row
 * @returns the label above, or beside, its formatted value
 */
export const FieldValue: FC<FieldValueProps> = ({
  label,
  value,
  superseded,
  testID,
  inline,
}) => {
  const { locale, t } = useLocale();

  return (
    <View style={inline ? inlineRow : { gap: 2 }}>
      <Text style={styles.label}>{label}</Text>
      <Text
        testID={testID}
        style={[
          styles.body,
          inline && inlineValue,
          superseded && {
            color: colors.muted,
            textDecorationLine: 'line-through',
          },
        ]}>
        {formatFieldValue(value, locale, t)}
      </Text>
    </View>
  );
};
