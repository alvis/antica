import { Image, StyleSheet } from 'react-native';

import { toImageSource } from './image-source.js';
import scrim from './images/scrim.png';

import type { FC } from 'react';

/** properties for the shade that keeps text and controls legible over a photo */
export type PhotoScrimProps = {
  /** the photo edge the shade starts from, darkest there */
  edge: 'top' | 'bottom';
  /** how far the shade reaches into the photo, in dp */
  height: number;
  /** darkness at the edge, from 0 to 1 */
  strength: number;
};

const layout = StyleSheet.create({
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    pointerEvents: 'none',
  },
  // the asset fades from black at its top edge; the bottom shade is the same image turned over
  bottom: { bottom: 0, transform: [{ scaleY: -1 }] },
  top: { top: 0 },
});

/**
 * renders a linear black-to-clear shade over a photo edge, the sheet's gradient scrim; a
 * stretched alpha image stands in for CSS gradients, which React Native cannot draw
 * @param root0 scrim properties
 * @param root0.edge the edge the shade starts from
 * @param root0.height how far it reaches
 * @param root0.strength darkness at the edge
 * @returns the decorative shade, hidden from assistive technology
 */
export const PhotoScrim: FC<PhotoScrimProps> = ({ edge, height, strength }) => (
  <Image
    source={toImageSource(scrim)}
    resizeMode="stretch"
    accessibilityElementsHidden
    importantForAccessibility="no"
    style={[layout.scrim, layout[edge], { height, opacity: strength }]}
  />
);
