import { StyleSheet } from 'react-native';

import { componentStates } from './theme-states.js';
import {
  border,
  color,
  elevation,
  focus,
  font,
  motion,
  radius,
  size,
  space,
  type,
} from './tokens.js';

/** the approved 宣紙墨綠 theme: foundation tokens plus each component's states */
export const theme = {
  color,
  font,
  type,
  space,
  radius,
  border,
  elevation,
  size,
  motion,
  focus,
  state: componentStates,
} as const;

/** the theme's shape, for consumers that receive it as a value */
export type Theme = typeof theme;

/**
 * earlier colour names mapped onto the theme, so screens not yet rebuilt take on 宣紙墨綠
 */
export const colors = {
  canvas: color.bg.page,
  card: color.bg.surface,
  jade: color.action.primary,
  text: color.text.primary,
  muted: color.text.secondary,
  border: color.border.subtle,
  error: color.status.danger,
  warning: color.status.warning,
} as const;

const { button, textInput } = componentStates;

/** shared native styles for screens that have not moved to the primitives yet */
export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg.page },
  content: {
    paddingHorizontal: space.page,
    paddingTop: space[8],
    paddingBottom: 120,
    gap: space.section,
  },
  card: {
    backgroundColor: color.bg.surface,
    borderRadius: radius.card,
    padding: space.card,
    gap: space.stack,
    ...elevation.card,
  },
  title: { ...type.display, color: color.text.primary },
  heading: { ...type.section, color: color.text.primary },
  body: { ...type.body, color: color.text.primary },
  secondary: { ...type.body2, color: color.text.secondary },
  error: { ...type.body, color: color.status.danger },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space[8],
  },
  field: {
    minHeight: textInput.height,
    borderWidth: border.input.width,
    borderColor: border.input.color,
    borderRadius: textInput.radius,
    backgroundColor: textInput.default.bg,
    paddingHorizontal: textInput.paddingH,
    paddingVertical: space[12],
    color: textInput.default.fg,
    fontFamily: font.family.sans,
    fontSize: 16,
  },
  label: { ...type.label, color: color.text.secondary },
  button: {
    minHeight: button.height,
    backgroundColor: button.primary.default.bg,
    borderRadius: button.radius,
    paddingHorizontal: button.paddingH,
    paddingVertical: space[12],
    flexDirection: 'row',
    gap: space[8],
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: {
    ...type.button,
    color: button.primary.default.fg,
    textAlign: 'center',
  },
  secondaryButton: {
    minHeight: button.height,
    backgroundColor: button.secondary.default.bg,
    borderColor: button.secondary.default.border.color,
    borderWidth: button.secondary.default.border.width,
    borderRadius: button.radius,
    paddingHorizontal: button.paddingH,
    paddingVertical: space[12],
    flexDirection: 'row',
    gap: space[8],
    justifyContent: 'center',
    alignItems: 'center',
  },
  secondaryButtonText: {
    ...type.button,
    color: button.secondary.default.fg,
    textAlign: 'center',
  },
  divider: {
    height: border.hairline.width,
    backgroundColor: color.border.subtle,
  },
});
