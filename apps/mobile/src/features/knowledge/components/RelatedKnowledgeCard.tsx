import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgeCitations } from './KnowledgeCitations';

import type { FC } from 'react';

import type {
  KnowledgeAttachment,
  RelatedKnowledgePage,
} from '@antica/contracts';

/** One revision-pinned contextual preview and explicit collector actions. */
export type RelatedKnowledgeCardProps = {
  card: RelatedKnowledgePage['cards'][number];
  onOpen: () => void;
  onAttach?: (attachment: KnowledgeAttachment, title: string) => void;
  attachDisabled?: boolean;
};
const kindKeys = {
  concept: 'knowledgeConcept',
  method: 'knowledgeMethod',
  object_example: 'knowledgeExample',
} as const;
const fieldKeys = {
  category: 'knowledgeFacetCategory',
  material: 'material',
  period: 'period',
  name: 'name',
} as const;

/**
 * Shows the server's match reasons and cited excerpt beside an explicit open action.
 * @param props saved contextual card and available collector actions
 * @param props.card saved title, metadata and excerpt
 * @param props.onOpen opens this exact revision
 * @param props.onAttach explicitly selects the preview claim for the composer
 * @param props.attachDisabled selection is unavailable while capped or sending
 * @returns source-aware related card
 */
export const RelatedKnowledgeCard: FC<RelatedKnowledgeCardProps> = ({
  card,
  onOpen,
  onAttach,
  attachDisabled,
}) => {
  const { t } = useLocale();

  return (
    <View testID={`record-related-${card.entryId}`} style={styles.card}>
      <ActionButton
        testID={`record-related-open-${card.entryId}`}
        label={card.title}
        onPress={onOpen}
        secondary
      />
      <Text style={styles.secondary}>
        {t(kindKeys[card.kind])} ·{' '}
        {card.category.map((category) => category.label).join(' · ')}
      </Text>
      {card.fallback && (
        <Text style={styles.secondary}>
          {t('knowledgeLanguageFallback', { language: card.language })}
        </Text>
      )}
      {card.matches.map((match, index) => (
        <Text key={index} style={styles.body}>
          {t('knowledgeMatchReason', {
            reason: `${t(fieldKeys[match.field])}: ${match.label} (${match.value})`,
          })}
        </Text>
      ))}
      {card.excerpt && (
        <View>
          <Text style={styles.body}>{card.excerpt.text}</Text>
          <KnowledgeCitations
            citations={card.excerpt.citations}
            testIDPrefix={`record-related-citation-${card.entryId}`}
          />
        </View>
      )}
      <Text style={styles.secondary}>{card.providers.join(' · ')}</Text>
      <RelatedKnowledgeActions
        card={card}
        onAttach={onAttach}
        attachDisabled={attachDisabled}
      />
    </View>
  );
};

/**
 * Offers explicit selection only when a reviewed, located source can be sent.
 * @param props preview and composer selection state
 * @param props.card saved preview with its claim
 * @param props.onAttach explicit collector action
 * @param props.attachDisabled composer is capped or sending
 * @returns card and claim attachment controls
 */
const RelatedKnowledgeActions: FC<
  Pick<RelatedKnowledgeCardProps, 'card' | 'onAttach' | 'attachDisabled'>
> = ({ card, onAttach, attachDisabled }) => {
  const { t } = useLocale();
  const excerpt = card.excerpt;
  const citationLimit = 3;
  const supports =
    excerpt?.citations
      .filter(
        (citation) =>
          citation.relation === 'supports' &&
          citation.verification === 'located',
      )
      .slice(0, citationLimit) ?? [];
  if (!onAttach || !excerpt || !supports.length) {
    return null;
  }
  const attach = (): void =>
    onAttach(
      {
        entryId: card.entryId,
        revision: card.revision,
        claimKey: excerpt.claimKey,
        citationIds: supports.map((citation) => citation.id),
      },
      card.title,
    );

  return (
    <View>
      <ActionButton
        testID={`record-related-attach-${card.entryId}`}
        label={t('knowledgeUseInMessage')}
        disabled={attachDisabled}
        onPress={attach}
        secondary
      />
      <ActionButton
        testID={`record-related-claim-${card.entryId}`}
        label={t('knowledgeAttachClaim')}
        disabled={attachDisabled}
        onPress={attach}
        secondary
      />
    </View>
  );
};
