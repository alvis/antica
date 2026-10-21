import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme.js';

import type { FC } from 'react';

/** where a capture check stands */
export type ChecklistStatus = 'todo' | 'done' | 'current';

/** properties for one capture-checklist chip shown over the camera */
export type ChecklistChipProps = {
  label: string;
  status: ChecklistStatus;
  /** spoken status, such as 已拍; the tick alone is not announced */
  statusLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
};

const chip = theme.state.checklistChip;

const layout = StyleSheet.create({
  hit: {
    minHeight: theme.size.hitMin,
    justifyContent: 'center',
  },
  face: {
    minHeight: chip.minHeight,
    borderRadius: chip.radius,
    paddingLeft: theme.space[8],
    paddingRight: theme.space[14],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[6],
  },
  dot: {
    width: chip.dot,
    height: chip.dot,
    borderRadius: chip.dot / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotMark: { ...theme.font.face('sans', '700'), fontSize: 12 },
  label: { fontSize: 14 },
});

/**
 * renders one checklist chip: open, done with a tick, or current in solid white
 * @param root0 chip properties
 * @param root0.label name of the check, such as 底足
 * @param root0.status whether the check is open, done or current
 * @param root0.statusLabel spoken status
 * @param root0.onPress selects the check
 * @param root0.disabled prevents interaction when true
 * @param root0.testID stable automation identifier
 * @returns the pressable check with its status mark
 */
export const ChecklistChip: FC<ChecklistChipProps> = ({
  label,
  status,
  statusLabel,
  onPress,
  disabled,
  testID,
}) => {
  const tone = chip[status];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={statusLabel ? { text: statusLabel } : undefined}
      aria-selected={status === 'current'}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={layout.hit}>
      <View
        style={[
          layout.face,
          { backgroundColor: tone.bg },
          status === 'todo' && {
            borderWidth: 1,
            borderColor: chip.todo.border,
          },
        ]}>
        <View
          style={[
            layout.dot,
            status === 'done'
              ? { backgroundColor: chip.done.dotBg }
              : { borderWidth: 1.5, borderColor: tone.fg },
          ]}>
          {status === 'done' && (
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={[layout.dotMark, { color: chip.done.dotFg }]}>
              ✓
            </Text>
          )}
        </View>
        <Text
          style={[
            layout.label,
            {
              color: tone.fg,
              ...theme.font.face('sans', status === 'current' ? '700' : '500'),
            },
          ]}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
};
