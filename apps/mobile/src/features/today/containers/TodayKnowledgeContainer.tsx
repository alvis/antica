import { useRouter } from 'expo-router';

import { StyleSheet, View } from 'react-native';

import { theme } from '@antica/ui';

import { SectionHeader } from '../../../components/SectionHeader';
import { useAskAssistant } from '../../../providers/AskAssistantProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { useKnowledgePreview } from '../../knowledge/hooks/useKnowledgePreview';
import { useRelatedKnowledge } from '../../knowledge/hooks/useRelatedKnowledge';
import {
  describeRelatedMatch,
  knowledgeKindKeys,
} from '../../knowledge/related-match';

import { TodayKnowledgeCard } from '../components/TodayKnowledgeCard';

import type { FC } from 'react';

import type { RelatedKnowledgePage } from '@antica/contracts';

import type { AnalysedRecord } from '../hooks/useTodayInbox';

/** properties for 今日知識, tied to the record that was just analysed */
export type TodayKnowledgeContainerProps = {
  record: AnalysedRecord;
};

const layout = StyleSheet.create({ section: { gap: theme.space[12] } });

/**
 * 今日知識: the first saved entry related to the record that was just analysed, with a reviewed
 * quote; nothing shows while the record has no related entry
 * @param root0 section properties
 * @param root0.record the analysed record
 * @returns the section, or nothing
 */
export const TodayKnowledgeContainer: FC<TodayKnowledgeContainerProps> = ({
  record,
}) => {
  const related = useRelatedKnowledge(record.recordId, record.recordRevision);
  const cards = related.data?.cards ?? [];
  const card = cards.find((candidate) => candidate.excerpt) ?? cards.at(0);

  return card ? <TodayKnowledgeSection record={record} card={card} /> : null;
};

/**
 * the section once its entry is known: header, then the card with photo, quote and question
 * @param props section properties
 * @param props.record the analysed record
 * @param props.card the related entry
 * @returns the 今日知識 section
 */
const TodayKnowledgeSection: FC<{
  record: AnalysedRecord;
  card: RelatedKnowledgePage['cards'][number];
}> = ({ record, card }) => {
  const router = useRouter();
  const ask = useAskAssistant();
  const { t, locale } = useLocale();
  // the card's photo spans the screen, so it takes the print-sized rendition
  const preview = useKnowledgePreview(
    card.entryId,
    card.revision,
    card.excerpt?.claimKey,
    'wide',
  );
  const question = t('todayKnowledgeQuestion', { record: record.name });
  const kicker = [
    t(knowledgeKindKeys[card.kind]),
    card.category[0]?.label,
    preview.claimCount === undefined
      ? undefined
      : t('todayKnowledgeClaims', { count: preview.claimCount }),
  ]
    .filter(Boolean)
    .join(t('metaSeparator'));
  const match = card.matches.at(0);

  return (
    <View testID="today-knowledge" style={layout.section}>
      <SectionHeader
        title={t('todayKnowledge')}
        links={[
          {
            label: t('knowledgeLibrary'),
            onPress: () => router.push('/knowledge'),
          },
        ]}
      />
      <TodayKnowledgeCard
        testID={`today-knowledge-${card.entryId}`}
        title={card.title}
        kicker={kicker}
        photo={{ image: preview.image, credit: preview.credit }}
        quote={preview.quote?.text}
        footnote={preview.quote?.number}
        why={
          // the next step the analysis asked for is why this entry matters today
          record.nextStep
            ? t('todayKnowledgeWhyStep', {
                record: record.name,
                step: record.nextStep,
              })
            : t('todayKnowledgeWhy', {
                record: record.name,
                reason: match
                  ? describeRelatedMatch(match, t, locale)
                  : card.title,
              })
        }
        question={question}
        onOpenEntry={() =>
          router.push(
            `/knowledge/${card.entryId}?view=revision&revision=${card.revision}`,
          )
        }
        onAsk={() =>
          ask?.open({
            kind: 'knowledge',
            entryId: card.entryId,
            title: card.title,
            question,
          })
        }
      />
    </View>
  );
};
