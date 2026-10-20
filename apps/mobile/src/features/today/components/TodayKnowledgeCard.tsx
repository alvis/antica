import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssistantSeal, CitationFootnote, Icon, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { KnowledgePhoto } from '../../knowledge/components/KnowledgePhoto';

import type { FC } from 'react';

import type { KnowledgePhotoProps } from '../../knowledge/components/KnowledgePhoto';

/** properties for 今日知識: one saved entry tied to a record that was just analysed */
export type TodayKnowledgeCardProps = {
  title: string;
  /** kind, category and how many claims carry a source */
  kicker: string;
  photo: Pick<KnowledgePhotoProps, 'image' | 'credit'>;
  /** one reviewed claim of the entry, quoted */
  quote?: string;
  /** the quote's footnote number */
  footnote?: number;
  /** why this entry is today's, tied to the collector's record */
  why: string;
  /** the suggested question that opens the assistant already answered */
  question: string;
  onOpenEntry: () => void;
  onAsk: () => void;
  testID?: string;
};

const layout = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    ...theme.elevation.card,
  },
  photo: { height: 196 },
  body: { padding: theme.space.card },
  kicker: {
    ...theme.type.micro,
    letterSpacing: 0.48,
    color: theme.color.accent.default,
  },
  titleHit: {
    minHeight: theme.size.hitMin,
    justifyContent: 'center',
    marginTop: theme.space[4],
  },
  title: { ...theme.type.heading, color: theme.color.text.primary },
  quote: {
    marginTop: theme.space[4],
    ...theme.font.face('serif', '400'),
    fontSize: 14,
    lineHeight: 22.4,
    color: theme.color.text.secondary,
  },
  why: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[8],
    marginTop: theme.space[8],
  },
  whyText: {
    flex: 1,
    ...theme.font.face('sans', '400'),
    fontSize: 14,
    lineHeight: 21.7,
    color: theme.color.text.secondary,
  },
  whyLead: {
    ...theme.font.face('sans', '600'),
    color: theme.color.text.primary,
  },
  ask: {
    minHeight: theme.size.rowMin,
    marginTop: theme.space[12],
    paddingVertical: theme.space[6],
    paddingLeft: theme.space[10],
    paddingRight: theme.space[8],
    borderRadius: theme.radius.field,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[10],
    backgroundColor: theme.color.assistant.soft,
  },
  pressed: { opacity: 0.75 },
  askText: {
    flex: 1,
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    lineHeight: 21,
    color: theme.color.assistant.onSoft,
  },
});

/**
 * 今日知識: the entry's photo with its credit, kicker, title, a cited quote, why it is today's,
 * and a suggested question for the assistant
 * @param root0 card properties
 * @param root0.title entry title
 * @param root0.kicker kind, category and claim count
 * @param root0.photo the entry's image and credit
 * @param root0.quote one reviewed claim
 * @param root0.footnote the quote's footnote number
 * @param root0.why why it is today's entry
 * @param root0.question the suggested question
 * @param root0.onOpenEntry opens the entry
 * @param root0.onAsk opens the assistant with the question answered
 * @param root0.testID stable automation identifier
 * @returns the card
 */
export const TodayKnowledgeCard: FC<TodayKnowledgeCardProps> = ({
  title,
  kicker,
  photo,
  quote,
  footnote,
  why,
  question,
  onOpenEntry,
  onAsk,
  testID,
}) => {
  const { t } = useLocale();

  return (
    <View testID={testID} style={layout.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('todayKnowledgeOpen', { title })}
        onPress={onOpenEntry}>
        <KnowledgePhoto
          image={photo.image}
          credit={photo.credit}
          accessibilityLabel={title}
          style={layout.photo}
        />
      </Pressable>
      <View style={layout.body}>
        <Text style={layout.kicker}>{kicker}</Text>
        <Pressable
          testID={testID && `${testID}-title`}
          accessibilityRole="button"
          onPress={onOpenEntry}
          style={layout.titleHit}>
          <Text style={layout.title}>{title}</Text>
        </Pressable>
        {quote && (
          // the footnote flows after the quote's last character, as a footnote mark does
          <Text style={layout.quote}>
            {t('quoted', { text: quote })}
            {footnote !== undefined && (
              <CitationFootnote
                number={footnote}
                label={t('knowledgeSource')}
                onPress={onOpenEntry}
                inline
              />
            )}
          </Text>
        )}
        <View style={layout.why}>
          <Icon name="spark" size={18} color={theme.color.accent.default} />
          <Text style={layout.whyText}>
            <Text style={layout.whyLead}>{t('todayKnowledgeWhyLead')}</Text>
            {why}
          </Text>
        </View>
        <Pressable
          testID={testID && `${testID}-ask`}
          accessibilityRole="button"
          accessibilityLabel={t('todayKnowledgeAsk', { question })}
          onPress={onAsk}
          style={({ pressed }) => [layout.ask, pressed && layout.pressed]}>
          <AssistantSeal size="mini" />
          <Text style={layout.askText}>
            {t('todayKnowledgeAsk', { question })}
          </Text>
          <Icon name="chevron" size={18} color={theme.color.assistant.onSoft} />
        </Pressable>
      </View>
    </View>
  );
};
