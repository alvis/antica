import { useEffect, useRef } from 'react';

import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoScrim, theme } from '@antica/ui';

import type { FC, ReactNode } from 'react';

/** one page of the record's photo carousel */
export interface HeroPhoto {
  readonly id: string;
  /** signed read of the photo; the dark mat shows while it has none */
  readonly uri?: string;
  /** spoken description, such as the angle and file name */
  readonly label: string;
  /** stable automation identifier, carrying the upload state */
  readonly testID: string;
}

/** properties for the record hub's full-bleed photo carousel */
export type RecordHeroProps = {
  photos: readonly HeroPhoto[];
  /** index of the page on screen */
  index: number;
  onIndexChange: (index: number) => void;
  /** opens the photo on its own screen */
  onOpenPhoto: (id: string) => void;
  /** the page indicator, such as 1 / 6 · 正面 */
  count?: { text: string; accessibilityLabel: string };
  /** controls along the top edge: back at the left, the assistant at the right */
  start: ReactNode;
  end: ReactNode;
};

/** the hero's height from the screen's top edge, status bar included */
export const heroHeight = 300;

const layout = StyleSheet.create({
  hero: { height: heroHeight, backgroundColor: theme.color.photo.hero },
  page: { height: heroHeight },
  photo: { width: '100%', height: '100%' },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: theme.state.appBar.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: theme.space[4],
    paddingRight: theme.space[6],
  },
  count: {
    position: 'absolute',
    right: theme.space[12],
    bottom: theme.space[12],
    minHeight: 28,
    paddingHorizontal: theme.space[10],
    borderRadius: 14,
    justifyContent: 'center',
    backgroundColor: 'rgba(12,12,12,0.62)',
  },
  countText: {
    ...theme.type.small,
    lineHeight: 18,
    color: theme.color.photo.onPhoto,
  },
});

/**
 * the record's photos edge to edge under the status bar, paged by swipe, with the top bar's
 * controls laid over a shade and the page indicator at the bottom right
 * @param root0 hero properties
 * @param root0.photos carousel pages in order
 * @param root0.index page on screen
 * @param root0.onIndexChange receives the page a swipe settles on
 * @param root0.onOpenPhoto opens a photo on its own screen
 * @param root0.count page indicator text and its spoken form
 * @param root0.start control at the top left
 * @param root0.end control at the top right
 * @returns the hero
 */
export const RecordHero: FC<RecordHeroProps> = ({
  photos,
  index,
  onIndexChange,
  onOpenPhoto,
  count,
  start,
  end,
}) => {
  const { width } = useWindowDimensions();
  const { top } = useSafeAreaInsets();
  const list = useRef<FlatList<HeroPhoto>>(null);
  const settled = useRef(index);

  useEffect(() => {
    // a thumbnail press moves the carousel; a swipe has already moved it
    if (settled.current !== index && index < photos.length) {
      settled.current = index;
      list.current?.scrollToIndex({ index, animated: true });
    }
  }, [index, photos.length]);

  return (
    <View style={layout.hero}>
      <FlatList
        ref={list}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(photo) => photo.id}
        getItemLayout={(_, item) => ({
          length: width,
          offset: width * item,
          index: item,
        })}
        onMomentumScrollEnd={(event) => {
          const page = Math.round(event.nativeEvent.contentOffset.x / width);
          settled.current = page;
          onIndexChange(page);
        }}
        renderItem={({ item }) => (
          <Pressable
            testID={item.testID}
            accessibilityRole="imagebutton"
            accessibilityLabel={item.label}
            onPress={() => onOpenPhoto(item.id)}
            style={[layout.page, { width }]}>
            {item.uri && (
              <Image
                source={{ uri: item.uri }}
                resizeMode="cover"
                style={layout.photo}
              />
            )}
          </Pressable>
        )}
      />
      {/* the sheet shades the top 120 dp so the status bar and controls read over any photo */}
      <PhotoScrim edge="top" height={120} strength={0.5} />
      <View style={[layout.bar, { top }]}>
        {start}
        {end}
      </View>
      {count && (
        <View
          testID="record-media-count"
          accessible
          accessibilityLabel={count.accessibilityLabel}
          style={layout.count}>
          <Text style={layout.countText}>{count.text}</Text>
        </View>
      )}
    </View>
  );
};
