import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, styles, theme } from '@antica/ui';

import type { FC } from 'react';

/** properties of one choice in the interface-language radio group */
export type LanguageOptionProps = {
  /** language name in its own writing system, or the Follow system label */
  label: string;
  /** secondary text such as Default or the language Follow system resolves to */
  detail?: string;
  /** whether this choice is the selected draft */
  checked: boolean;
  /** prevents selection while a save is running */
  disabled?: boolean;
  /** selects this choice */
  onPress: () => void;
  /** stable automation identifier */
  testID?: string;
};

const layout = StyleSheet.create({
  option: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  disabled: { opacity: 0.5 },
  ring: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.jade,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.jade },
  text: { flex: 1 },
  label: {
    color: colors.text,
    fontSize: 18,
    ...theme.font.face('sans', '600'),
  },
});

/**
 * renders one radio choice whose selected state is announced and drawn as a filled ring
 * @param props option properties
 * @param props.label language name in its own writing system
 * @param props.detail optional secondary text
 * @param props.checked whether this choice is selected
 * @param props.disabled prevents selection when true
 * @param props.onPress selects this choice
 * @param props.testID stable automation identifier
 * @returns the accessible radio row
 */
export const LanguageOption: FC<LanguageOptionProps> = ({
  label,
  detail,
  checked,
  disabled,
  onPress,
  testID,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="radio"
    accessibilityLabel={detail ? `${label}, ${detail}` : label}
    // aria-checked reaches both native accessibility state and the web radio role
    aria-checked={checked}
    accessibilityState={{ disabled: Boolean(disabled) }}
    disabled={disabled}
    onPress={onPress}
    style={[layout.option, disabled && layout.disabled]}>
    <View style={layout.ring}>{checked && <View style={layout.dot} />}</View>
    <View style={layout.text}>
      <Text style={layout.label}>{label}</Text>
      {detail && <Text style={styles.secondary}>{detail}</Text>}
    </View>
  </Pressable>
);
