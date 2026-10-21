import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { confidenceKeys } from '../../collection/confidence-keys';

import type { FC } from 'react';

/** Confidence reported by the proposal; absent values have no badge. */
export type ProposalConfidence = 'high' | 'medium' | 'low';

const levels = { high: 3, medium: 2, low: 1 } as const;
const layout = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: theme.space[6] },
  label: {
    ...theme.font.face('sans', '600'),
    fontSize: 12,
    lineHeight: 16.8,
    color: theme.color.text.secondary,
  },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  bar: {
    width: 4,
    height: 12,
    borderRadius: 1,
    backgroundColor: theme.color.border.strong,
  },
  filled: { backgroundColor: theme.color.accent.default },
});

/**
 * Shows the proposal's confidence with v5's three equal-height bars.
 * @param props badge properties
 * @param props.confidence the reported level, without an inferred fallback
 * @returns the badge, or nothing when confidence is absent
 */
export const SuggestionConfidence: FC<{
  confidence?: ProposalConfidence;
}> = ({ confidence }) => {
  const { t } = useLocale();
  if (!confidence) {
    return null;
  }

  return (
    <View style={layout.badge}>
      <Text style={layout.label}>{t(confidenceKeys[confidence])}</Text>
      <View
        style={layout.bars}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {[1, 2, 3].map((level) => (
          <View
            key={level}
            style={[layout.bar, level <= levels[confidence] && layout.filled]}
          />
        ))}
      </View>
    </View>
  );
};
