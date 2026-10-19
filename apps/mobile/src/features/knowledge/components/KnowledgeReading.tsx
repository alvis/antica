import { Text } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { useKnowledgeTopics } from '../hooks/useKnowledgeTopics';

import { CitedClaim } from './CitedClaim';
import { KnowledgeChoice } from './KnowledgeChoice';

import type { FC } from 'react';

import type { KnowledgeEntryDetailV2 } from '@antica/contracts';

import type { CitedClaimProps } from './CitedClaim';

interface ReadingProps {
  entry: KnowledgeEntryDetailV2;
  original: boolean;
  setOriginal: (value: boolean) => void;
  onCitation: CitedClaimProps['onCitation'];
}
/**
 * renders reading-first evidence and always-available language controls
 * @param props entry and reader language preference
 * @param props.entry immutable current revision
 * @param props.original reader original-text preference
 * @param props.setOriginal changes the reader language preference
 * @param props.onCitation opens captured evidence
 * @returns cited claims and entry provenance
 */
export const KnowledgeReading: FC<ReadingProps> = ({
  entry,
  original,
  setOriginal,
  onCitation,
}) => {
  const { locale, t } = useLocale();
  const title =
    entry.content.titles.find((item) => item.language === locale) ??
    entry.content.titles[0];

  return (
    <>
      <KnowledgeEntryStatus entry={entry} />
      <KnowledgeEntryTopics entry={entry} />
      {entry.content.entryType === 'object_example' && (
        <Text style={styles.body}>{t('knowledgeExample')}</Text>
      )}
      {title.language !== locale && (
        <Text style={styles.secondary}>
          {t('knowledgeLanguageFallback', {
            language: title.language,
          })}
        </Text>
      )}
      <KnowledgeChoice
        selected={original}
        testID="knowledge-language-original"
        label={t('knowledgeOriginal')}
        onPress={() => setOriginal(true)}
      />
      <KnowledgeChoice
        selected={!original}
        testID="knowledge-language-translated"
        label={t('knowledgeTranslation')}
        onPress={() => setOriginal(false)}
      />
      {entry.content.claims.map((claim) => (
        <CitedClaim
          key={claim.claimKey}
          claim={claim}
          citations={entry.content.citations}
          original={original}
          onCitation={onCitation}
        />
      ))}
    </>
  );
};
/**
 * displays saved and editorial review states as text
 * @param props immutable entry
 * @param props.entry immutable current revision
 * @returns status text
 */
const KnowledgeEntryStatus: FC<Pick<ReadingProps, 'entry'>> = ({ entry }) => {
  const { t } = useLocale();

  return (
    <Text style={styles.secondary}>
      {t(entry.status === 'saved' ? 'knowledgeSaved' : 'knowledgeDrafts')} ·{' '}
      {t(
        entry.content.editorialReview.state === 'reviewed'
          ? 'knowledgeReviewReviewed'
          : entry.content.editorialReview.state === 'rejected'
            ? 'knowledgeReviewRejected'
            : 'knowledgeReviewPending',
      )}
    </Text>
  );
};

/**
 * resolves topic identities through the shared locale-aware taxonomy cache
 * @param props current entry
 * @param props.entry assignments from the pinned revision
 * @returns topic labels and recoverable taxonomy feedback
 */
const KnowledgeEntryTopics: FC<Pick<ReadingProps, 'entry'>> = ({ entry }) => {
  const { t } = useLocale();
  const { groups } = useKnowledgeTopics(null, true);
  const topics = groups.flatMap((group) => group.data ?? []);
  if (!entry.content.topics.length) {
    return null;
  }

  return (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('knowledgeRelatedTopics')}
      </Text>
      {entry.content.topics.map((assignment) => {
        const topic = topics.find((item) => item.id === assignment.topicId);

        return (
          <Text key={assignment.topicId} style={styles.body}>
            {topic?.label ?? t('loading')}
            {assignment.uncertainty ? ` · ${assignment.uncertainty}` : ''}
          </Text>
        );
      })}
      {groups.some((group) => group.isError) && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {t('knowledgeLoadError')}
          </Text>
          <ActionButton
            label={t('retry')}
            onPress={() => {
              for (const group of groups) {
                if (group.isError) {
                  void group.refetch();
                }
              }
            }}
          />
        </>
      )}
    </>
  );
};
