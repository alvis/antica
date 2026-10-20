import { useQueries } from '@tanstack/react-query';

import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, styles, theme } from '@antica/ui';

import { SectionHeader } from '../../../components/SectionHeader';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import {
  knowledgeClaimLimit,
  knowledgeEntryLimit,
} from '../../collection/messages/hooks/useKnowledgeAttachments';

import { RelatedKnowledgeCard } from '../components/RelatedKnowledgeCard';
import { RelatedKnowledgeStripCard } from '../components/RelatedKnowledgeStripCard';
import { knowledgeDetailQuery } from '../hooks/useKnowledgeEntry';
import { distinctCardImages } from '../hooks/useKnowledgePreview';
import { useRelatedKnowledge } from '../hooks/useRelatedKnowledge';

import type { UseQueryResult } from '@tanstack/react-query';

import type { FC } from 'react';

import type {
  RelatedKnowledgePage,
  KnowledgeAttachment,
} from '@antica/contracts';

/** Record-local discovery, optionally offering an explicit composer selection. */
export type RelatedKnowledgeContainerProps = {
  recordId: string;
  recordRevision?: number;
  onAttach?: (attachment: KnowledgeAttachment, title: string) => void;
  attachments?: KnowledgeAttachment[];
  busy?: boolean;
};
const layout = StyleSheet.create({
  tray: { maxHeight: 220 },
  content: { gap: 8 },
  section: { gap: theme.space[12] },
  inset: { paddingHorizontal: theme.space.page, gap: 8 },
  strip: {
    gap: theme.space[12],
    paddingHorizontal: theme.space.page,
    paddingBottom: theme.space[4],
  },
});

/**
 * Isolates discovery loading and failures from the record and its conversation.
 * @param props record context and optional composer selection
 * @param props.recordId owner-scoped record identity
 * @param props.recordRevision record revision on screen
 * @param props.onAttach collector selection action; absent on the record hub, which shows a strip
 * @param props.attachments current visible composer references
 * @param props.busy locks selection during a send
 * @returns local related-knowledge section or scrollable candidate tray
 */
export const RelatedKnowledgeContainer: FC<RelatedKnowledgeContainerProps> = ({
  recordId,
  recordRevision,
  onAttach,
  attachments = [],
  busy,
}) => {
  const related = useRelatedKnowledge(recordId, recordRevision);

  return onAttach ? (
    <ScrollView
      testID="record-messages-related"
      style={layout.tray}
      keyboardShouldPersistTaps="handled">
      <RelatedKnowledgeContent
        related={related}
        onAttach={onAttach}
        attachments={attachments}
        busy={busy}
      />
    </ScrollView>
  ) : (
    <RelatedKnowledgeStrip related={related} />
  );
};

/**
 * the record hub's 相關知識: a section header with the library link over a strip of entry cards
 * that bleeds to the screen edges
 * @param props query state
 * @param props.related local query state
 * @returns the section
 */
const RelatedKnowledgeStrip: FC<{
  related: UseQueryResult<RelatedKnowledgePage, Error>;
}> = ({ related }) => {
  const { t, locale } = useLocale();
  const { api, userId } = useAuth();
  const router = useRouter();
  const cards = related.data?.cards ?? [];
  // the strip reads every card's pinned revision so it can give each a different photo
  const entries = useQueries({
    queries: cards.map((card) =>
      knowledgeDetailQuery({
        api,
        userId,
        locale,
        entryId: card.entryId,
        view: 'revision',
        revision: card.revision,
      }),
    ),
  });
  const images = distinctCardImages(
    entries.map((entry) => {
      const content = entry.data?.content;

      return content?.images;
    }),
  );

  return (
    <View testID="record-related-knowledge" style={layout.section}>
      <View style={layout.inset}>
        <SectionHeader
          title={t('knowledgeRelated')}
          links={[
            {
              label: t('knowledgeLibrary'),
              onPress: () => router.push('/knowledge'),
            },
          ]}
        />
        <RelatedKnowledgeStatus related={related} />
      </View>
      {cards.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={layout.strip}>
          {cards.map((card, index) => (
            <RelatedKnowledgeStripCard
              key={card.entryId}
              card={card}
              image={images[index]}
              onOpen={() =>
                router.push(
                  `/knowledge/${card.entryId}?view=revision&revision=${card.revision}`,
                )
              }
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
};

/**
 * Renders local discovery state and explicit selection controls.
 * @param props query result and composer state
 * @param props.related local query state
 * @param props.onAttach explicit collector selection
 * @param props.attachments visible references
 * @param props.busy composer send state
 * @returns related cards and recovery states
 */
const RelatedKnowledgeContent: FC<
  Pick<RelatedKnowledgeContainerProps, 'onAttach' | 'busy'> & {
    related: UseQueryResult<RelatedKnowledgePage, Error>;
    attachments: KnowledgeAttachment[];
  }
> = ({ related, onAttach, attachments, busy }) => {
  const { t } = useLocale();
  const router = useRouter();
  const entries = new Set(attachments.map((attachment) => attachment.entryId));

  return (
    <View style={layout.content}>
      <Text accessibilityRole="header" style={styles.heading}>
        {t('knowledgeRelated')}
      </Text>
      {onAttach && (
        <Text style={styles.secondary}>{t('knowledgeCandidatesHint')}</Text>
      )}
      <RelatedKnowledgeStatus related={related} />
      {related.data?.cards.map((card) => (
        <RelatedKnowledgeCard
          key={card.entryId}
          card={card}
          onOpen={() =>
            router.push(
              `/knowledge/${card.entryId}?view=revision&revision=${card.revision}`,
            )
          }
          onAttach={onAttach}
          attachDisabled={
            Boolean(busy) ||
            attachments.length >= knowledgeClaimLimit ||
            (entries.size >= knowledgeEntryLimit &&
              !entries.has(card.entryId)) ||
            attachments.some(
              (attachment) =>
                attachment.entryId === card.entryId &&
                attachment.revision === card.revision &&
                attachment.claimKey === card.excerpt?.claimKey,
            )
          }
        />
      ))}
    </View>
  );
};

/**
 * Keeps loading, empty reasons and recoverable failures local.
 * @param props related query state
 * @param props.related current request
 * @returns section status and retry action
 */
const RelatedKnowledgeStatus: FC<{
  related: UseQueryResult<RelatedKnowledgePage, Error>;
}> = ({ related }) => {
  const { t } = useLocale();

  return (
    <>
      {related.isPending && (
        <Text
          testID="record-related-loading"
          accessibilityLiveRegion="polite"
          style={styles.secondary}>
          {t('loading')}
        </Text>
      )}
      {related.isError && (
        <View testID="record-related-error">
          <Text accessibilityRole="alert" style={styles.error}>
            {t('knowledgeLoadError')}
          </Text>
          <ActionButton
            testID="record-related-retry"
            label={t('retry')}
            onPress={() => {
              void related.refetch();
            }}
            secondary
          />
        </View>
      )}
      {related.data?.cards.length === 0 && (
        <Text testID="record-related-empty" style={styles.secondary}>
          {t(
            related.data.reason === 'no_match'
              ? 'knowledgeNoRelated'
              : 'knowledgeNoContent',
          )}
        </Text>
      )}
    </>
  );
};
