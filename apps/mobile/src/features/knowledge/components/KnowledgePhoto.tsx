import { Image, StyleSheet, Text, View } from 'react-native';

import { PhotoScrim, theme } from '@antica/ui';

import { useRemoteKnowledgeImage } from '../hooks/useRemoteKnowledgeImage';

import type { FC } from 'react';

import type { StyleProp, ViewStyle } from 'react-native';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

/** a cropped knowledge photo, filling its frame, with an optional credit band */
export type KnowledgePhotoProps = {
  /** the entry's image; the paper mat stays while there is none */
  image?: KnowledgeContentEnvelopeV2['images'][number];
  /** what the photo shows, spoken in place of the image */
  accessibilityLabel: string;
  /** museum and licence line laid over the bottom of the photo */
  credit?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

// the shade covers two credit lines with their 28 dp lead-in, as the sheet's band does
const creditBand = 72;

const layout = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: theme.color.bg.photoMat,
  },
  credit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingTop: 28,
    paddingHorizontal: theme.space[12],
    paddingBottom: theme.space[8],
  },
  creditText: {
    ...theme.type.small,
    fontSize: 12,
    lineHeight: 17,
    color: theme.color.photo.onPhoto,
    // a pale photo can lighten the gradient; the shadow keeps each glyph edged in black
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 4,
  },
});

/**
 * shows a knowledge entry's museum photo cropped to its frame, keeping the bytes in memory only
 * @param root0 photo properties
 * @param root0.image the entry's image
 * @param root0.accessibilityLabel what the photo shows
 * @param root0.credit museum and licence line
 * @param root0.style frame size and corners
 * @param root0.testID stable automation identifier
 * @returns the framed photo, or its mat while it loads or is unavailable
 */
export const KnowledgePhoto: FC<KnowledgePhotoProps> = ({
  image,
  accessibilityLabel,
  credit,
  style,
  testID,
}) => {
  const { uri, failed, markFailed } = useRemoteKnowledgeImage(
    image?.imageUrl ?? '',
    image !== undefined,
  );

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      style={[layout.frame, style]}>
      {uri && !failed && (
        <Image
          source={{ uri }}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onError={markFailed}
        />
      )}
      {credit && (
        <>
          {/* the sheet's clear-to-66% band, darkest under the text */}
          <PhotoScrim edge="bottom" height={creditBand} strength={0.66} />
          <View style={layout.credit}>
            <Text style={layout.creditText}>{credit}</Text>
          </View>
        </>
      )}
    </View>
  );
};
