import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { FieldBadge } from '../record-hub';

/** one fact the hub shows as a tile, such as 年代 */
export interface RecordFact {
  readonly key: string;
  readonly label: string;
  /** the saved value as read, or nothing while the record leaves it unknown */
  readonly value?: string;
  /** whether a suggestion or an edit card waits on this fact */
  readonly badge?: FieldBadge;
  /** opens where the fact is decided: the suggestion, the edit card, or the editor */
  readonly onPress: () => void;
}

/** properties for the hub's two-column grid of key facts */
export type RecordFactTilesProps = {
  facts: readonly RecordFact[];
};

const layout = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[10],
  },
  tile: {
    // two columns with the 10 dp gutter between them
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 72,
    paddingVertical: theme.space[12],
    paddingHorizontal: theme.space[14],
    borderRadius: theme.radius.card,
    backgroundColor: theme.color.bg.surface,
    ...theme.elevation.card,
  },
  pressed: { backgroundColor: theme.color.card.pressed },
  label: { ...theme.type.small, color: theme.color.text.tertiary },
  value: {
    marginTop: theme.space[2],
    ...theme.font.face('sans', '600'),
    fontSize: 16,
    lineHeight: 24,
    color: theme.color.text.primary,
  },
  empty: {
    ...theme.font.face('sans', '500'),
    color: theme.color.text.tertiary,
  },
  badge: {
    position: 'absolute',
    top: theme.space[10],
    right: theme.space[10],
  },
});

/**
 * the record's key facts as tiles, each marked when a suggestion or edit card waits on it;
 * an unknown fact reads 未填寫 rather than being guessed
 * @param root0 grid properties
 * @param root0.facts tiles in display order
 * @returns the grid
 */
export const RecordFactTiles: FC<RecordFactTilesProps> = ({ facts }) => {
  const { t } = useLocale();

  return (
    <View style={layout.grid}>
      {facts.map((fact) => {
        const badge =
          fact.badge &&
          t(
            fact.badge === 'suggestion'
              ? 'recordFactSuggested'
              : 'recordFactEditWaiting',
          );
        const value = fact.value ?? t('recordFactEmpty');

        return (
          <Pressable
            key={fact.key}
            testID={`record-fact-${fact.key}`}
            accessibilityRole="button"
            accessibilityLabel={[fact.label, value, badge]
              .filter(Boolean)
              .join(t('spokenSeparator'))}
            onPress={fact.onPress}
            style={({ pressed }) => [layout.tile, pressed && layout.pressed]}>
            <Text style={layout.label}>{fact.label}</Text>
            <Text style={[layout.value, !fact.value && layout.empty]}>
              {value}
            </Text>
            {badge && (
              <View style={layout.badge}>
                <Badge label={badge} tone="warning" />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
};
