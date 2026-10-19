import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { KnowledgeSearchHit } from '@antica/contracts';

/** a revision-pinned discovery result and its explicit read action */
export type KnowledgeResultCardProps = {
  hit: KnowledgeSearchHit;
  onOpen: () => void;
};

/**
 * renders source-aware search results without saving on open
 * @param root0 component properties
 * @param root0.hit hit property
 * @param root0.onOpen onOpen property
 * @returns rendered knowledge content
 */
export const KnowledgeResultCard: FC<KnowledgeResultCardProps> = ({
  hit,
  onOpen,
}) => {
  const { t } = useLocale();

  return (
    <View testID={`knowledge-result-${hit.id}`} style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {hit.title}
      </Text>
      <Text style={styles.secondary}>
        {t(hit.status === 'saved' ? 'knowledgeSaved' : 'knowledgeDrafts')} ·{' '}
        {t(
          hit.reviewState === 'reviewed'
            ? 'knowledgeReviewReviewed'
            : hit.reviewState === 'rejected'
              ? 'knowledgeReviewRejected'
              : 'knowledgeReviewPending',
        )}
      </Text>
      {hit.kind === 'object_example' && (
        <Text style={styles.body}>{t('knowledgeExample')}</Text>
      )}
      {hit.fallback && (
        <Text style={styles.secondary}>
          {t('knowledgeLanguageFallback', { language: hit.language })}
        </Text>
      )}
      {hit.excerpt && <Text style={styles.body}>{hit.excerpt.text}</Text>}
      <Text style={styles.secondary}>{hit.providers.join(' · ')}</Text>
      <ActionButton label={t('view')} onPress={onOpen} secondary />
    </View>
  );
};
