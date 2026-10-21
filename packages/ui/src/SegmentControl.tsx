import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme.js';

import type { ReactElement } from 'react';

/** one choice in a segment control */
export type SegmentOption<Value extends string> = {
  value: Value;
  label: string;
  disabled?: boolean;
  /** count shown beside the label, such as pending suggestions */
  badge?: number;
  /** opens another screen instead of becoming the current segment, so it reads as a link */
  navigates?: boolean;
  testID?: string;
};

/** properties for a single-choice segment bar */
export type SegmentControlProps<Value extends string> = {
  /** spoken name of the whole bar */
  accessibilityLabel: string;
  value: Value;
  onChange: (value: Value) => void;
  options: ReadonlyArray<SegmentOption<Value>>;
  testID?: string;
};

const segment = theme.state.segmentControl;

const layout = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: segment.bg,
    borderRadius: segment.radius,
    padding: segment.padding,
    gap: theme.space[4],
  },
  item: {
    flex: 1,
    minHeight: segment.itemMinHeight,
    borderRadius: segment.itemRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.space[4],
    paddingHorizontal: theme.space[6],
  },
  current: {
    backgroundColor: segment.current.bg,
    ...theme.elevation.segActive,
  },
  label: { fontSize: segment.fontSize },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: theme.space[4],
    backgroundColor: segment.badge.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: segment.badge.fg,
    ...theme.font.face('sans', '700'),
    fontSize: 12,
    // Noto Sans TC's tall ascent and descent, plus Android's font padding, overflow the 20 dp pill
    lineHeight: 16,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
});

/**
 * renders a tab-like segment bar; the current segment is not pressable again, and a segment that
 * opens another screen is announced as a link
 * @param root0 segment bar properties
 * @param root0.accessibilityLabel spoken name of the bar
 * @param root0.value selected value
 * @param root0.onChange receives a newly selected value
 * @param root0.options choices in display order
 * @param root0.testID stable automation identifier for the bar
 * @returns the segment bar
 */
export const SegmentControl = <Value extends string>({
  accessibilityLabel,
  value,
  onChange,
  options,
  testID,
}: SegmentControlProps<Value>): ReactElement => (
  <View
    testID={testID}
    accessibilityRole="tablist"
    accessibilityLabel={accessibilityLabel}
    style={layout.bar}>
    {options.map((option) => {
      const selected = option.value === value;

      return (
        <Pressable
          key={option.value}
          testID={option.testID}
          accessibilityRole={option.navigates ? 'link' : 'tab'}
          accessibilityLabel={option.label}
          aria-selected={option.navigates ? undefined : selected}
          accessibilityState={{ disabled: Boolean(option.disabled) }}
          accessibilityValue={
            option.badge ? { text: String(option.badge) } : undefined
          }
          disabled={option.disabled}
          hitSlop={(segment.itemHitHeight - segment.itemMinHeight) / 2}
          onPress={() => {
            if (!selected) {
              onChange(option.value);
            }
          }}
          style={[layout.item, selected && layout.current]}>
          <Text
            style={[
              layout.label,
              {
                color: selected ? segment.current.fg : segment.default.fg,
                ...theme.font.face('sans', selected ? '700' : '500'),
              },
            ]}>
            {option.label}
          </Text>
          {option.badge ? (
            <View style={layout.badge}>
              <Text style={layout.badgeText}>{option.badge}</Text>
            </View>
          ) : null}
        </Pressable>
      );
    })}
  </View>
);
