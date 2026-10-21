import { Pressable, StyleSheet, Text } from 'react-native';

import { theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { describeRelatedMatch } from '../related-match';

import { KnowledgePhoto } from './KnowledgePhoto';

import type { FC } from 'react';

import type {
  KnowledgeContentEnvelopeV2,
  RelatedKnowledgePage,
} from '@antica/contracts';

type KnowledgeImage = KnowledgeContentEnvelopeV2['images'][number];

/** properties for one saved entry in the record's 相關知識 strip */
export type RelatedKnowledgeStripCardProps = {
  card: RelatedKnowledgePage['cards'][number];
  /** the photo the strip chose for this card, distinct from its neighbours' */
  image?: KnowledgeImage;
  onOpen: () => void;
};

const layout = StyleSheet.create({
  card: { width: 148 },
  pressed: { opacity: 0.75 },
  photo: { height: 110, borderRadius: theme.radius.photo },
  title: {
    marginTop: theme.space[8],
    ...theme.font.face('serif', '700'),
    fontSize: 15,
    lineHeight: 20.3,
    color: theme.color.text.primary,
  },
  why: {
    marginTop: theme.space[2],
    ...theme.type.micro,
    ...theme.font.face('sans', '400'),
    lineHeight: 17.4,
    color: theme.color.text.tertiary,
  },
});

/**
 * a 148 dp strip card: the entry's photo, its title, and why it relates to the record
 * @param root0 card properties
 * @param root0.card the related entry
 * @param root0.image the photo the strip chose for the card
 * @param root0.onOpen opens the entry at the revision the card pinned
 * @returns the pressable card
 */
export const RelatedKnowledgeStripCard: FC<RelatedKnowledgeStripCardProps> = ({
  card,
  image,
  onOpen,
}) => {
  const { t } = useLocale();
  const match = card.matches.at(0);
  const why = match
    ? t('relatedBecause', { reason: describeRelatedMatch(match, t) })
    : undefined;

  return (
    <Pressable
      testID={`record-related-open-${card.entryId}`}
      accessibilityRole="button"
      accessibilityLabel={[card.title, why]
        .filter(Boolean)
        .join(t('spokenSeparator'))}
      onPress={onOpen}
      style={({ pressed }) => [layout.card, pressed && layout.pressed]}>
      <KnowledgePhoto
        image={image}
        accessibilityLabel={card.title}
        style={layout.photo}
      />
      <Text numberOfLines={2} style={layout.title}>
        {card.title}
      </Text>
      {why && (
        <Text numberOfLines={2} style={layout.why}>
          {why}
        </Text>
      )}
    </Pressable>
  );
};
