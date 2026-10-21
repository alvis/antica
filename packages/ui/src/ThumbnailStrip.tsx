import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from './Icon.js';
import { theme } from './theme.js';

import type { FC } from 'react';

import type { IconName } from './Icon.js';

/** one image in a thumbnail strip */
export type ThumbnailItem = {
  id: string;
  /** the photo's read; the paper mat shows while it has none */
  uri?: string;
  /** spoken description of the image */
  label: string;
  testID?: string;
};

/** properties for the strip of photos under a carousel */
export type ThumbnailStripProps = {
  items: readonly ThumbnailItem[];
  selectedId?: string;
  onSelect: (id: string) => void;
  /** how many photos the strip shows before it counts the rest, such as +2 */
  limit?: number;
  /** labelled action at the strip's far end, such as 找相似 */
  action?: {
    label: string;
    onPress: () => void;
    icon?: IconName;
    testID?: string;
  };
  testID?: string;
};

const strip = theme.state.thumbStrip;
const { ring } = strip.current;
// the ring is an outline: it sits outside the thumbnail and takes no room in the row
const ringInset = -(ring.width + ring.offset);

const layout = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: strip.gap,
    alignItems: 'center',
    paddingHorizontal: theme.space.page,
  },
  thumb: {
    width: strip.thumb,
    height: strip.thumb,
    borderRadius: strip.radius,
    backgroundColor: theme.color.bg.photoMat,
  },
  image: {
    width: strip.thumb,
    height: strip.thumb,
    borderRadius: strip.radius,
  },
  ring: {
    position: 'absolute',
    top: ringInset,
    right: ringInset,
    bottom: ringInset,
    left: ringInset,
    borderWidth: ring.width,
    borderColor: ring.color,
    borderRadius: strip.radius + ring.offset + ring.width,
  },
  more: {
    width: 28,
    textAlign: 'center',
    ...theme.type.micro,
    ...theme.font.face('sans', '400'),
    color: theme.color.text.tertiary,
  },
  action: {
    marginLeft: 'auto',
    minHeight: theme.size.hitMin,
    paddingHorizontal: theme.space[12],
    borderRadius: theme.radius.control,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    backgroundColor: theme.color.bg.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[6],
  },
  actionText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    color: theme.color.text.primary,
  },
});

/**
 * renders the row of selectable photos under a carousel, counting those past the limit and
 * ending with an optional labelled action at the far edge
 * @param root0 strip properties
 * @param root0.items photos in display order
 * @param root0.selectedId photo currently shown above the strip
 * @param root0.onSelect receives the chosen photo id
 * @param root0.limit how many photos show before the rest are counted
 * @param root0.action labelled action after the photos
 * @param root0.testID stable automation identifier
 * @returns the strip, or nothing when there are no photos
 */
export const ThumbnailStrip: FC<ThumbnailStripProps> = ({
  items,
  selectedId,
  onSelect,
  limit = items.length,
  action,
  testID,
}) => {
  if (items.length === 0) {
    return null;
  }
  const shown = items.slice(0, limit);
  const rest = items.length - shown.length;

  return (
    <View testID={testID} style={layout.row}>
      {shown.map((item) => {
        const selected = item.id === selectedId;

        return (
          <Pressable
            key={item.id}
            testID={item.testID}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            aria-selected={selected}
            onPress={() => onSelect(item.id)}
            style={layout.thumb}>
            {item.uri ? (
              <Image source={{ uri: item.uri }} style={layout.image} />
            ) : null}
            {selected && <View pointerEvents="none" style={layout.ring} />}
          </Pressable>
        );
      })}
      {rest > 0 && <Text style={layout.more}>+{rest}</Text>}
      {action && (
        <Pressable
          testID={action.testID}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={layout.action}>
          {action.icon && <Icon name={action.icon} size={18} />}
          <Text style={layout.actionText}>{action.label}</Text>
        </Pressable>
      )}
    </View>
  );
};
