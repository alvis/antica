import { Pressable, StyleSheet, Text, View } from 'react-native';

import { theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgePhoto } from '../../knowledge/components/KnowledgePhoto';

import type { FC } from 'react';

import type { CitedEntry } from '../hooks/useCitedEntries';

/** properties for the museum example a suggestion rests on */
export type ExampleChipProps = {
  example: CitedEntry;
  onOpen: (example: CitedEntry) => void;
  testID?: string;
};

const layout = StyleSheet.create({
  example: {
    flex: 1,
    minWidth: 132,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    paddingVertical: theme.space[6],
    paddingLeft: theme.space[6],
    paddingRight: theme.space[10],
    borderRadius: theme.radius.photo * 0.7 + 4,
    backgroundColor: theme.color.accent.soft,
  },
  frame: {
    width: 52,
    height: 52,
    borderRadius: theme.radius.photo * 0.6,
  },
  text: { flex: 1, minWidth: 0 },
  title: {
    ...theme.font.face('sans', '700'),
    fontSize: 13,
    lineHeight: 17.6,
    color: theme.color.accent.onSoft,
  },
  meta: {
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: theme.color.accent.onSoft,
  },
  pressed: { opacity: 0.75 },
});

/**
 * shortens a museum's name the way the design's example chip does (大都會藝術博物館 → 大都會)
 * @param museum the museum's full name
 * @returns the short name
 */
function shortMuseum(museum: string): string {
  return museum.replace(/藝術博物館$/u, '');
}

/**
 * the museum example chip (v5 `.ex`): the saved entry's picture and title with the museum it
 * comes from, opening the entry
 * @param props chip properties
 * @param props.example the saved entry behind the cited source
 * @param props.onOpen opens the entry
 * @param props.testID stable automation identifier
 * @returns the chip
 */
export const ExampleChip: FC<ExampleChipProps> = ({
  example,
  onOpen,
  testID,
}) => {
  const { t } = useLocale();
  const meta = example.museum
    ? t('suggestionExample', { museum: shortMuseum(example.museum) })
    : undefined;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={
        meta ? `${example.title}${t('spokenSeparator')}${meta}` : example.title
      }
      onPress={() => onOpen(example)}
      style={({ pressed }) => [layout.example, pressed && layout.pressed]}>
      <KnowledgePhoto
        image={example.image}
        accessibilityLabel={example.title}
        style={layout.frame}
      />
      <View style={layout.text}>
        <Text style={layout.title}>{example.title}</Text>
        {meta && <Text style={layout.meta}>{meta}</Text>}
      </View>
    </Pressable>
  );
};
