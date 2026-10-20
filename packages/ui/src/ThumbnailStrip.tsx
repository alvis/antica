import { Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { theme } from './theme.js';

import type { FC } from 'react';

/** one image in a thumbnail strip */
export type ThumbnailItem = {
  id: string;
  uri: string;
  /** spoken description of the image */
  label: string;
};

/** properties for the strip of photos under a carousel */
export type ThumbnailStripProps = {
  items: readonly ThumbnailItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** labelled action that ends the strip, such as 找相似 */
  action?: { label: string; onPress: () => void; testID?: string };
  testID?: string;
};

const strip = theme.state.thumbStrip;
const { ring } = strip.current;
const ringBox = strip.thumb + 2 * (ring.width + ring.offset);

const layout = StyleSheet.create({
  row: {
    gap: strip.gap,
    alignItems: 'center',
    paddingHorizontal: theme.space.page,
  },
  frame: {
    width: Math.max(ringBox, theme.size.hitMin),
    height: Math.max(ringBox, theme.size.hitMin),
    borderRadius: strip.radius + ring.offset + ring.width,
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumb: {
    width: strip.thumb,
    height: strip.thumb,
    borderRadius: strip.radius,
    backgroundColor: theme.color.bg.photoMat,
  },
  action: {
    minHeight: theme.size.controlSmall,
    paddingHorizontal: theme.space[16],
    borderRadius: theme.radius.control,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    backgroundColor: theme.color.bg.surface,
    justifyContent: 'center',
  },
  actionText: {
    fontFamily: theme.font.family.sans,
    fontSize: 14,
    fontWeight: '600',
    color: theme.color.text.primary,
  },
});

/**
 * renders a horizontal strip of selectable photos, optionally ending with an action
 * @param root0 strip properties
 * @param root0.items photos in display order
 * @param root0.selectedId photo currently shown above the strip
 * @param root0.onSelect receives the chosen photo id
 * @param root0.action labelled action after the photos
 * @param root0.testID stable automation identifier
 * @returns the strip, or nothing when there are no photos
 */
export const ThumbnailStrip: FC<ThumbnailStripProps> = ({
  items,
  selectedId,
  onSelect,
  action,
  testID,
}) =>
  items.length === 0 ? null : (
    <ScrollView
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={layout.row}>
      {items.map((item) => {
        const selected = item.id === selectedId;

        return (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            aria-selected={selected}
            onPress={() => onSelect(item.id)}
            style={[
              layout.frame,
              selected && { borderWidth: ring.width, borderColor: ring.color },
            ]}>
            <Image source={{ uri: item.uri }} style={layout.thumb} />
          </Pressable>
        );
      })}
      {action && (
        <Pressable
          testID={action.testID}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={layout.action}>
          <Text style={layout.actionText}>{action.label}</Text>
        </Pressable>
      )}
    </ScrollView>
  );
