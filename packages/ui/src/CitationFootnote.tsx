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
  /** flows inside a line of text: the chip keeps the line's height and reaches 48 dp by hit slop */
  inline?: boolean;
  testID?: string;
};

const chip = theme.state.citation.chip;

// the slop that grows the inline chip's target to the 48 dp minimum
const inlineSlop = (theme.size.hitMin - chip.size) / 2;
// half the chip less the height of a 15 to 18 sp glyph's centre above the baseline (about 0.36 em)
const inlineDrop = 5;

const layout = StyleSheet.create({
  hit: {
    minHeight: theme.size.hitMin,
    minWidth: theme.size.hitMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // an inline view sits on the text's baseline; the drop centres the chip on body and reading text
  inline: {
    marginHorizontal: theme.space[4],
    transform: [{ translateY: inlineDrop }],
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
    ...theme.font.face('sans', '700'),
    fontSize: 12,
    lineHeight: 16,
  },
});

/**
 * renders a footnote number with a 48 dp target that opens the cited source
 * @param root0 citation properties
 * @param root0.number position of the source in the list of sources
 * @param root0.label spoken name of the source
 * @param root0.onPress opens the source
 * @param root0.inline whether the footnote flows inside a line of text
 * @param root0.testID stable automation identifier
 * @returns the pressable footnote number
 */
export const CitationFootnote: FC<CitationFootnoteProps> = ({
  number,
  label,
  onPress,
  inline = false,
  testID,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="link"
    accessibilityLabel={`${number} ${label}`}
    onPress={onPress}
    hitSlop={inline ? inlineSlop : undefined}
    style={inline ? layout.inline : layout.hit}>
    <View style={layout.chip}>
      <Text style={layout.number}>{number}</Text>
    </View>
  </Pressable>
);
