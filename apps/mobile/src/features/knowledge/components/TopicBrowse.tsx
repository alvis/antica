import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { KnowledgeTopicSummary } from '@antica/contracts';

/** topic choices retain backend identities and selected semantics */
export type TopicBrowseProps = {
  topics: KnowledgeTopicSummary[];
  selected: string[];
  onSelect: (topic: KnowledgeTopicSummary) => void;
  category?: boolean;
  filter?: boolean;
};
const layout = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: colors.jade,
    borderRadius: 8,
    flexGrow: 1,
    flexBasis: '40%',
  },
  selected: { backgroundColor: '#DCE9E0' },
});

/**
 * renders equally prominent categories or direct topic choices
 * @param root0 component properties
 * @param root0.topics topics property
 * @param root0.selected selected property
 * @param root0.onSelect onSelect property
 * @param root0.category category property
 * @param root0.filter filter property
 * @returns rendered knowledge content
 */
export const TopicBrowse: FC<TopicBrowseProps> = ({
  topics,
  selected,
  onSelect,
  category = false,
  filter = false,
}) => {
  const { t } = useLocale();

  return (
    <View style={layout.row}>
      {topics.map((topic) => (
        <Pressable
          key={topic.id}
          testID={`knowledge-${category ? 'category' : filter ? 'filter' : 'topic'}-${topic.id}`}
          accessibilityRole="button"
          accessibilityState={{ selected: selected.includes(topic.id) }}
          accessibilityLabel={topic.label}
          onPress={() => onSelect(topic)}
          style={[
            layout.button,
            selected.includes(topic.id) && layout.selected,
          ]}>
          <Text style={styles.body}>{topic.label}</Text>
          {topic.fallback && (
            <Text style={styles.secondary}>
              {t('knowledgeLanguageFallback', { language: topic.language })}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
};
