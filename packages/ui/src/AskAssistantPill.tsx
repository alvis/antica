import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme.js';

import type { FC } from 'react';

/** properties for the top-bar entry to the assistant */
export type AskAssistantPillProps = {
  /** visible and spoken label, such as 問助理 */
  label: string;
  onPress: () => void;
  /** `onPhoto` switches to dark glass over photos, in the same place and shape */
  variant?: 'light' | 'onPhoto';
  /** marks the pill while the ask sheet it opened is showing */
  expanded?: boolean;
  disabled?: boolean;
  testID?: string;
};

/** the assistant's seal character; a mark, not text, so it stays the same in every language */
const sealMark = '鑑';
const pill = theme.state.askPill;

const layout = StyleSheet.create({
  hit: {
    minHeight: pill.hitHeight,
    minWidth: pill.hitHeight,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  face: {
    height: pill.height,
    borderRadius: pill.radius,
    paddingLeft: 5,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[6],
  },
  seal: {
    width: pill.seal.size,
    height: pill.seal.size,
    borderRadius: pill.seal.radius,
    backgroundColor: pill.seal.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sealText: {
    color: pill.seal.fg,
    fontFamily: theme.font.family.serif,
    fontSize: 15,
    lineHeight: 18,
    fontWeight: '700',
  },
  label: {
    fontFamily: theme.font.family.sans,
    fontSize: 14,
    fontWeight: '600',
  },
});

/**
 * renders the assistant's red seal, the mark it carries on the pill and in its replies
 * @returns the seal, hidden from assistive technology because the label beside it speaks
 */
export const AssistantSeal: FC = () => (
  <View style={layout.seal}>
    <Text
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={layout.sealText}>
      {sealMark}
    </Text>
  </View>
);

/**
 * renders the 48 dp 「鑑 問助理」 pill that opens the context ask sheet
 * @param root0 pill properties
 * @param root0.label visible and spoken label
 * @param root0.onPress opens the ask sheet
 * @param root0.variant light on paper, or glass over photos
 * @param root0.expanded whether the ask sheet is open
 * @param root0.disabled prevents interaction when true
 * @param root0.testID stable automation identifier
 * @returns the pressable pill
 */
export const AskAssistantPill: FC<AskAssistantPillProps> = ({
  label,
  onPress,
  variant = 'light',
  expanded = false,
  disabled,
  testID,
}) => {
  const tone = pill[variant];

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-expanded={expanded}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={layout.hit}>
      {({ pressed }) => (
        <View
          style={[
            layout.face,
            { backgroundColor: tone.bg },
            expanded && {
              borderWidth: pill.expandedRing.width,
              borderColor: pill.expandedRing.color,
            },
          ]}>
          <AssistantSeal />
          <Text style={[layout.label, { color: tone.fg }]}>{label}</Text>
          {pressed && (
            <View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                {
                  borderRadius: pill.radius,
                  backgroundColor: pill.pressedOverlay,
                },
              ]}
            />
          )}
        </View>
      )}
    </Pressable>
  );
};
