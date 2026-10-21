import { border, color, focus, radius, size, type } from './tokens.js';

/**
 * component states from the approved token sheet; each value points at a foundation token
 */
export const componentStates = {
  button: {
    height: size.control,
    paddingH: 22,
    radius: radius.control,
    primary: {
      default: { bg: color.action.primary, fg: color.action.onPrimary },
      pressed: { bg: color.action.primaryPressed, fg: color.action.onPrimary },
      disabled: { bg: color.action.disabled, fg: color.action.onDisabled },
      loading: { bg: color.action.primary, fg: color.action.onPrimary },
    },
    secondary: {
      default: {
        bg: color.bg.surface,
        fg: color.text.primary,
        border: border.control,
      },
      pressed: {
        bg: color.bg.sunken,
        fg: color.text.primary,
        border: border.control,
      },
      disabled: {
        bg: color.bg.surface,
        fg: color.action.onDisabled,
        border: border.control,
      },
    },
    spinner: 18,
  },
  textInput: {
    height: size.control,
    paddingH: 14,
    radius: radius.field,
    default: {
      bg: color.bg.surface,
      fg: color.text.primary,
      border: border.input,
    },
    focused: { border: border.input, ring: focus.ring },
    error: { border: border.inputError, message: color.input.errorText },
    disabled: { bg: color.bg.sunken, fg: color.text.secondary },
    placeholder: color.text.tertiary,
  },
  askPill: {
    hitHeight: size.hitMin,
    height: 36,
    radius: 18,
    seal: {
      size: 26,
      radius: radius.assistant,
      bg: color.assistant.seal,
      fg: color.assistant.onSeal,
    },
    light: { bg: color.assistant.soft, fg: color.assistant.onSoft },
    onPhoto: { bg: color.photo.askGlass, fg: color.photo.onPhoto },
    pressedOverlay: 'rgba(0,0,0,0.03)',
    expandedRing: { width: 2, color: color.assistant.seal, offset: 1 },
  },
  appBar: {
    height: size.appBar,
    bg: color.bg.page,
    title: type.appbar,
    iconButton: size.iconButton,
  },
  tabBar: {
    height: size.tabBar,
    bg: color.nav.tabbar,
    borderTop: border.hairline,
    fontSize: 12,
    pill: { width: 56, height: 30, radius: 15, bg: color.nav.tabPill },
    default: { fg: color.text.tertiary, weight: '500' },
    current: { fg: color.text.primary, weight: '700' },
  },
  segmentControl: {
    bg: color.bg.sunken,
    padding: 4,
    radius: 19.6,
    itemMinHeight: 44,
    itemHitHeight: 52,
    itemRadius: radius.segment,
    fontSize: 15,
    default: { fg: color.text.secondary },
    current: { bg: color.bg.surface, fg: color.text.primary },
    badge: { bg: color.status.warningSoft, fg: color.status.warning },
  },
  card: {
    radius: radius.card,
    padding: 16,
    default: { bg: color.bg.surface },
    pressed: { bg: color.card.pressed },
  },
  badge: {
    height: 24,
    paddingH: 8,
    radius: radius.chip,
    accent: { bg: color.accent.soft, fg: color.accent.onSoft },
    warning: { bg: color.status.warningSoft, fg: color.status.warning },
    danger: { bg: color.status.dangerSoft, fg: color.status.danger },
    neutral: { bg: color.bg.sunken, fg: color.text.secondary },
    assistant: { bg: color.assistant.soft, fg: color.assistant.onSoft },
    onPhoto: { bg: color.photo.chip, fg: color.photo.onChip },
  },
  bottomSheet: {
    bg: color.bg.page,
    radiusTop: radius.sheet,
    grab: { width: 36, height: 4, radius: 2, color: color.border.strong },
    scrim: color.overlay.scrim,
    maxHeightOffset: 60,
  },
  checklistChip: {
    minHeight: 44,
    radius: 22,
    dot: 20,
    todo: {
      bg: color.camera.chip,
      fg: color.photo.onPhoto,
      border: color.camera.chipBorder,
    },
    done: {
      bg: color.camera.chip,
      fg: color.photo.onPhoto,
      dotBg: color.photo.onPhoto,
      dotFg: color.camera.onChipActive,
    },
    current: { bg: color.photo.onPhoto, fg: color.camera.onChipActive },
  },
  thumbStrip: {
    thumb: 52,
    radius: radius.thumb,
    gap: 6,
    current: { ring: { width: 2, color: color.text.primary, offset: 2 } },
  },
  citation: {
    footnote: { fg: color.accent.default, size: 12 },
    chip: {
      bg: color.accent.soft,
      fg: color.accent.onSoft,
      size: 20,
      radius: 10,
    },
  },
} as const;
