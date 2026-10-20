import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from './theme.js';

import type { FC } from 'react';

/** properties for a numbered citation that opens its source */
export type CitationFootnoteProps = {
  /** footnote number shown in the chip */
  number: number;
  /** spoken name of the source, such as the museum and its record */
  label: string;
  onPress: () => void;
  testID?: string;
};

const chip = theme.state.citation.chip;

const layout = StyleSheet.create({
  hit: {
    minHeight: theme.size.hitMin,
    minWidth: theme.size.hitMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    minWidth: chip.size,
    height: chip.size,
    borderRadius: chip.radius,
    paddingHorizontal: theme.space[4],
    backgroundColor: chip.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  number: {
    color: chip.fg,
    fontFamily: theme.font.family.sans,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
});

/**
 * renders a footnote number with a 48 dp target that opens the cited source
 * @param root0 citation properties
 * @param root0.number position of the source in the list of sources
 * @param root0.label spoken name of the source
 * @param root0.onPress opens the source
 * @param root0.testID stable automation identifier
 * @returns the pressable footnote number
 */
export const CitationFootnote: FC<CitationFootnoteProps> = ({
  number,
  label,
  onPress,
  testID,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="link"
    accessibilityLabel={`${number} ${label}`}
    onPress={onPress}
    style={layout.hit}>
    <View style={layout.chip}>
      <Text style={layout.number}>{number}</Text>
    </View>
  </Pressable>
);
