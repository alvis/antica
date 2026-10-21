import { Children, isValidElement } from 'react';

import { StyleSheet, Text as NativeText } from 'react-native';

import { bundledFaces } from '@antica/ui/faces';

import type { ComponentPropsWithRef, ReactElement, ReactNode } from 'react';

import type { TextStyle } from 'react-native';

/** properties of React Native's Text, ref included */
export type GlyphSafeTextProps = ComponentPropsWithRef<typeof NativeText>;

// the faces whose ink overhangs their advance; read from the import-free faces module, because
// @antica/ui's index imports react-native, which resolves to this module on Android
const serifFaces: readonly string[] = Object.values(bundledFaces.serif);
// a hair space: room the line breaker lets hang past the line's end. It is part of the text, so
// selectable text copies it and onTextLayout reports it; no serif text in the app is selectable,
// and the accessible name below keeps it out of what screen readers and UI automation read
const trailingRoom = ' ';

/** text content with room after its last glyph, and the words it says */
export interface TrailingRoom {
  /** the content to render */
  readonly children: ReactNode;
  /** the words of the content and of any text nested in it, for its accessible name */
  readonly label?: string;
}

/**
 * ends text content with a hair space, so the line carries room for its last glyph's ink
 * @param children text content
 * @returns the content with the hair space and its words, or the content unchanged when it does
 *   not end in text or already ends in white space
 */
export function withTrailingRoom(children: ReactNode): TrailingRoom {
  const parts = Children.toArray(children);
  const last = parts.at(-1);

  if (!isWords(last) || /\s$/u.test(String(last))) {
    return { children };
  }

  return { children: [...parts, trailingRoom], label: wordsOf(parts) };
}

/**
 * React Native's Text for Android with room after the last serif glyph. Android breaks a TextView's
 * line by the glyphs' ink, while React Native sizes the view by their advances; a Noto Serif TC
 * glyph whose ink overhangs its advance then wraps onto a hidden second line, so a label that hugs
 * its text loses its last character (研究紀錄 drew as 研究紀). A trailing hair space gives the ink
 * room the line breaker lets hang; the accessible name keeps the original words, so screen readers
 * and UI automation read the label unchanged.
 * @param props React Native Text properties
 * @param props.children the words, and any nested text, to render
 * @param props.style the style whose family decides whether the text needs room
 * @param props.accessibilityLabel the caller's accessible name, kept when given
 * @returns the native text, with the room and its accessible name when it needs them
 */
export function GlyphSafeText({
  children,
  style,
  accessibilityLabel,
  ...props
}: GlyphSafeTextProps): ReactElement {
  // flattening no style gives undefined
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const room =
    flat?.fontFamily !== undefined && serifFaces.includes(flat.fontFamily)
      ? withTrailingRoom(children)
      : { children };

  return (
    <NativeText
      {...props}
      style={style}
      accessibilityLabel={accessibilityLabel ?? room.label}>
      {room.children}
    </NativeText>
  );
}

/**
 * tells words from elements among text children
 * @param part one child
 * @returns whether the child renders as words
 */
function isWords(part: unknown): part is string | number {
  return typeof part === 'string' || typeof part === 'number';
}

/**
 * joins the words of text children, reading into nested elements such as an inner bold span
 * @param node text children
 * @returns the words in reading order
 */
function wordsOf(node: ReactNode): string {
  if (isWords(node)) {
    return String(node);
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return wordsOf(node.props.children);
  }

  return Children.toArray(node).map(wordsOf).join('');
}
