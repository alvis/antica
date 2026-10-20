import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { theme } from '@antica/ui';

import { RecordPhoto } from '../../../components/RecordPhoto';

import type { FC } from 'react';

/** one object on the 最近的藏品 shelf */
export interface ShelfItem {
  readonly recordId: string;
  readonly name: string;
  readonly photoUri: string | null;
  /** when it was added, such as 今天 or 10月17日 */
  readonly when?: string;
}

/** properties for the horizontal shelf of recent records */
export type RecentShelfProps = {
  items: readonly ShelfItem[];
  onOpen: (recordId: string) => void;
};

const layout = StyleSheet.create({
  // the shelf runs to the screen edges while its first card lines up with the page margin
  scroll: { marginHorizontal: -theme.space.page },
  content: { gap: theme.space[12], paddingHorizontal: theme.space.page },
  item: { width: 132 },
  pressed: { opacity: 0.75 },
  photo: { height: 168, borderRadius: theme.radius.photo },
  name: {
    ...theme.font.face('serif', '700'),
    fontSize: 15,
    lineHeight: 20.3,
    color: theme.color.text.primary,
    marginTop: theme.space[8],
  },
  when: { ...theme.type.small, color: theme.color.text.tertiary },
});

/**
 * the shelf of recent records: photo, serif name and when it was added
 * @param root0 shelf properties
 * @param root0.items recent records, newest first
 * @param root0.onOpen opens one record
 * @returns the horizontally scrolling shelf
 */
export const RecentShelf: FC<RecentShelfProps> = ({ items, onOpen }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    style={layout.scroll}
    contentContainerStyle={layout.content}>
    {items.map((item) => (
      <Pressable
        key={item.recordId}
        testID={`today-recent-${item.recordId}`}
        accessibilityRole="button"
        accessibilityLabel={
          item.when ? `${item.name}，${item.when}` : item.name
        }
        onPress={() => onOpen(item.recordId)}
        style={({ pressed }) => [layout.item, pressed && layout.pressed]}>
        <RecordPhoto uri={item.photoUri} style={layout.photo} />
        <Text numberOfLines={1} style={layout.name}>
          {item.name}
        </Text>
        {item.when && <Text style={layout.when}>{item.when}</Text>}
      </Pressable>
    ))}
  </ScrollView>
);
