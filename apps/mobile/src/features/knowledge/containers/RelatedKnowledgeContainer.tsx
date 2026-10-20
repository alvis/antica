import { useQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { relatedKnowledgePageSchema } from '@antica/contracts';
import { ActionButton, styles } from '@antica/ui';

import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import {
  knowledgeClaimLimit,
  knowledgeEntryLimit,
} from '../../collection/messages/hooks/useKnowledgeAttachments';

import { RelatedKnowledgeCard } from '../components/RelatedKnowledgeCard';

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
});

/**
 * Isolates discovery loading and failures from the record and its conversation.
 * @param props record context and optional composer selection
 * @param props.recordId owner-scoped record identity
 * @param props.recordRevision record revision on screen
 * @param props.onAttach collector selection action; absent on the record surface
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
  const content = (
    <RelatedKnowledgeContent
      related={related}
      onAttach={onAttach}
      attachments={attachments}
      busy={busy}
    />
  );

  return onAttach ? (
    <ScrollView
      testID="record-messages-related"
      style={layout.tray}
      keyboardShouldPersistTaps="handled">
      {content}
    </ScrollView>
  ) : (
    <View testID="record-related-knowledge">{content}</View>
  );
};

/**
 * Reads the owner-scoped current candidates for a visible record revision.
 * @param recordId record identity
 * @param recordRevision optional shown revision
 * @returns section-local query state
 */
function useRelatedKnowledge(
  recordId: string,
  recordRevision: number | undefined,
): UseQueryResult<RelatedKnowledgePage, Error> {
  const { api, userId } = useAuth();
  const { locale } = useLocale();

  return useQuery({
    queryKey: [
      'record-related-knowledge',
      userId,
      recordId,
      recordRevision,
      locale,
    ],
    queryFn: async ({ signal }) => {
      const parameters = new URLSearchParams({ locale, limit: '3' });
      if (recordRevision !== undefined) {
        parameters.set('recordRevision', String(recordRevision));
      }

      return api.get(
        `/v1/records/${encodeURIComponent(recordId)}/related-knowledge?${parameters}`,
        relatedKnowledgePageSchema,
        signal,
      );
    },
    retry: false,
  });
}

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
