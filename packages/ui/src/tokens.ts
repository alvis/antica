import { Platform } from 'react-native';

import type { TextStyle, ViewStyle } from 'react-native';

/**
 * 宣紙墨綠 colours, keyed by the React Native names in the approved token sheet (v5 `tokens.json`)
 */
export const color = {
  bg: {
    page: '#F4F0E6',
    surface: '#FFFDF7',
    sunken: '#ECE6D8',
    dock: '#FFFDF7',
    photoMat: '#DCD5C5',
  },
  text: { primary: '#1D211E', secondary: '#474C46', tertiary: '#5B5F58' },
  border: { subtle: '#E2DBCB', strong: '#C9C1AE' },
  action: {
    primary: '#1F4A38',
    primaryPressed: '#173A2C',
    onPrimary: '#FFFFFF',
    disabled: '#D9D3C5',
    onDisabled: '#4C4E47',
  },
  accent: { default: '#2A6650', soft: '#E2EDE5', onSoft: '#1D4636' },
  assistant: {
    seal: '#A63A24',
    onSeal: '#FFFFFF',
    soft: '#F7E8E2',
    onSoft: '#86301D',
  },
  status: {
    danger: '#9E3620',
    dangerSoft: '#FAE8E2',
    warning: '#744C00',
    warningSoft: '#FAEFD3',
    highlight: '#F5DFA4',
  },
  nav: {
    tabbar: 'rgba(244,240,230,0.97)',
    tabPill: '#E3DBC9',
    tabIndicator: 'transparent',
  },
  chat: { bubble: '#1F4A38', onBubble: '#FFFFFF' },
  overlay: { scrim: 'rgba(24,26,22,0.46)' },
  photo: {
    glass: 'rgba(12,12,12,0.42)',
    askGlass: 'rgba(12,12,12,0.5)',
    chip: 'rgba(255,255,255,0.94)',
    onChip: '#141414',
    onPhoto: '#FFFFFF',
    hero: '#151515',
  },
  camera: {
    bg: '#0B0C0C',
    chip: 'rgba(12,12,12,0.55)',
    chipBorder: 'rgba(255,255,255,0.28)',
    hint: 'rgba(12,12,12,0.66)',
    onChipActive: '#111111',
  },
  upload: { ring: '#1E5A42', retry: '#9E2A17' },
  card: { pressed: '#ECE6D8' },
  input: { errorBorder: '#9E3620', errorText: '#9E3620' },
} as const;

/**
 * system CJK families only: iOS names its Traditional Chinese faces, Android resolves CJK
 * through its generic families (Noto Sans / Serif CJK where the system ships them)
 */
export const font = {
  family: {
    sans: Platform.select({ ios: 'PingFang TC', default: 'sans-serif' }),
    serif: Platform.select({ ios: 'Songti TC', default: 'serif' }),
    latinSerif: Platform.select({ ios: 'Georgia', default: 'serif' }),
  },
} as const;

/** one row of the sheet's type scale */
interface TypeRole {
  /** family the role renders in */
  family: string;
  /** size in dp */
  size: number;
  /** line height as a multiple of the size */
  ratio: number;
  /** numeric weight */
  weight: '400' | '500' | '600' | '700';
  /** letter spacing as a fraction of the size */
  tracking?: number;
}

/** the sheet rounds line heights to 0.1 dp and tracking to 0.01 dp */
const precision = { lineHeight: 10, tracking: 100 } as const;

/**
 * turns a type-scale row into a text style, rounding line height and tracking as the sheet does
 * @param row the sheet's row for one role
 * @param row.family family the role renders in
 * @param row.size size in dp
 * @param row.ratio line height as a multiple of the size
 * @param row.weight numeric weight
 * @param row.tracking letter spacing as a fraction of the size
 * @returns the text style for the role
 */
function role({
  family,
  size,
  ratio,
  weight,
  tracking = 0,
}: TypeRole): TextStyle {
  return {
    fontFamily: family,
    fontSize: size,
    lineHeight:
      Math.round(size * ratio * precision.lineHeight) / precision.lineHeight,
    fontWeight: weight,
    letterSpacing:
      Math.round(size * tracking * precision.tracking) / precision.tracking,
  };
}

const { sans, serif } = font.family;
/** display roles track at 0.02 em, labels at 0.04 em */
const tracking = { display: 0.02, label: 0.04 } as const;

/** type roles: serif for display and reading, sans for interface text */
export const type = {
  display: role({
    family: serif,
    size: 32,
    ratio: 1.25,
    weight: '700',
    tracking: tracking.display,
  }),
  title: role({
    family: serif,
    size: 24,
    ratio: 1.35,
    weight: '700',
    tracking: tracking.display,
  }),
  section: role({
    family: serif,
    size: 19,
    ratio: 1.4,
    weight: '700',
    tracking: tracking.display,
  }),
  suggestValue: role({ family: serif, size: 19, ratio: 1.4, weight: '700' }),
  quote: role({ family: serif, size: 18, ratio: 1.75, weight: '400' }),
  heading: role({ family: serif, size: 18, ratio: 1.4, weight: '700' }),
  appbar: role({ family: sans, size: 17, ratio: 1.4, weight: '600' }),
  reading: role({ family: serif, size: 16, ratio: 1.85, weight: '400' }),
  button: role({ family: sans, size: 16, ratio: 1.4, weight: '600' }),
  body: role({ family: sans, size: 15, ratio: 1.6, weight: '400' }),
  chat: role({ family: sans, size: 15, ratio: 1.75, weight: '400' }),
  body2: role({ family: sans, size: 14, ratio: 1.6, weight: '400' }),
  small: role({ family: sans, size: 13, ratio: 1.5, weight: '400' }),
  label: role({
    family: sans,
    size: 13,
    ratio: 1.4,
    weight: '600',
    tracking: tracking.label,
  }),
  micro: role({ family: sans, size: 12, ratio: 1.4, weight: '600' }),
} as const;

/** spacing grid and its semantic aliases */
export const space = {
  2: 2,
  4: 4,
  6: 6,
  8: 8,
  10: 10,
  12: 12,
  14: 14,
  16: 16,
  24: 24,
  32: 32,
  page: 16,
  stack: 12,
  section: 24,
  card: 16,
} as const;

/** corner radii */
export const radius = {
  card: 16,
  control: 26,
  chip: 12,
  photo: 12,
  sheet: 24,
  field: 12,
  assistant: 8,
  segment: 15.6,
  thumb: 7.2,
} as const;

/** stroke widths and colours */
export const border = {
  hairline: { width: 1, color: color.border.subtle },
  control: { width: 1, color: color.border.strong },
  /** X8: border.control is 1.76:1 against cards, so an input border uses text.tertiary */
  input: { width: 1, color: color.text.tertiary },
  inputError: { width: 1.5, color: color.input.errorBorder },
  dashedTodo: { width: 1.5, style: 'dashed', color: color.border.strong },
} as const;

/**
 * elevations approximate the sheet's CSS shadows: iOS keeps the dominant layer
 * (shadowRadius = blur / 2) and Android uses an elevation, to be checked by eye on a device
 */
export const elevation = {
  card: {
    shadowColor: '#3C3018',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  float: {
    shadowColor: '#141E18',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
    elevation: 6,
  },
  segActive: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.12,
    shadowRadius: 1.5,
    elevation: 1,
  },
  sheetPicker: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    elevation: 16,
  },
} as const satisfies Record<string, ViewStyle>;

/** control and bar sizes */
export const size = {
  rowMin: 52,
  control: 52,
  controlSmall: 48,
  hitMin: 48,
  iconButton: 48,
  tabBar: 64,
  appBar: 56,
} as const;

/** motion; every animation is skipped when the system asks for reduced motion */
export const motion = {
  press: { scale: 0.98, durationMs: 100 },
  toast: { translateY: 8, durationMs: 200, visibleMs: 2400 },
} as const;

/** keyboard and switch-control focus ring */
export const focus = {
  ring: { width: 2, color: color.accent.default, offset: 2 },
} as const;
