import { Image } from 'react-native';

import arrow from './icons/arrow.png';
import back from './icons/back.png';
import book from './icons/book.png';
import camera from './icons/camera.png';
import chat from './icons/chat.png';
import check from './icons/check.png';
import chevron from './icons/chevron.png';
import close from './icons/close.png';
import edit from './icons/edit.png';
import grid from './icons/grid.png';
import imageSearch from './icons/image-search.png';
import info from './icons/info.png';
import mic from './icons/mic.png';
import ruler from './icons/ruler.png';
import search from './icons/search.png';
import spark from './icons/spark.png';
import today from './icons/today.png';
import undo from './icons/undo.png';
import user from './icons/user.png';
import { toImageSource } from './image-source.js';
import { theme } from './theme.js';

import type { FC } from 'react';

/** the approved sheet's stroke icons, rendered from its 24 dp symbols at 1.75 dp strokes */
const glyphs = {
  arrow,
  back,
  book,
  camera,
  chat,
  check,
  chevron,
  close,
  edit,
  grid,
  imageSearch,
  info,
  mic,
  ruler,
  search,
  spark,
  today,
  undo,
  user,
} as const;

/** names of the shipped icons */
export type IconName = keyof typeof glyphs;

/** the sheet's three icon sizes: regular, small (`sm`) and extra small (`xs`) */
export type IconSize = 24 | 18 | 16;

/** properties for one decorative stroke icon */
export type IconProps = {
  name: IconName;
  /** rendered size in dp */
  size?: IconSize;
  /** stroke colour; defaults to the primary text colour */
  color?: string;
  testID?: string;
};

/**
 * renders a design icon tinted to the given colour; icons are decorative, so the control
 * that holds one carries the spoken label
 * @param root0 icon properties
 * @param root0.name which icon
 * @param root0.size rendered size in dp
 * @param root0.color stroke colour
 * @param root0.testID stable automation identifier
 * @returns the tinted icon, hidden from assistive technology
 */
export const Icon: FC<IconProps> = ({
  name,
  size = 24,
  color = theme.color.text.primary,
  testID,
}) => (
  <Image
    testID={testID}
    source={toImageSource(glyphs[name])}
    accessibilityElementsHidden
    importantForAccessibility="no"
    style={{ width: size, height: size, tintColor: color }}
  />
);
