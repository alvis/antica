import { useQuery } from '@tanstack/react-query';

import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { colors, styles } from '@antica/ui';

import { QueryState } from '../../../../components/QueryState';
import { Screen } from '../../../../components/Screen';
import { useAuth } from '../../../../providers/AuthProvider';
import { useLocale } from '../../../../providers/LocaleProvider';

import { RelatedKnowledgeContainer } from '../../../knowledge/containers/RelatedKnowledgeContainer';

import { recordQuery } from '../../api/record-query';

import { KnowledgeEvidenceCard } from '../components/KnowledgeEvidenceCard';

import { MessageBubble } from '../components/MessageBubble';
import { MessageButton } from '../components/MessageButton';
import { MessageComposer } from '../components/MessageComposer';
import { ReplyStatus } from '../components/ReplyStatus';
import { useEditCardStates } from '../hooks/useEditCardStates';
import { useMessageComposer } from '../hooks/useMessageComposer';
import { useMessageFocus } from '../hooks/useMessageFocus';
import { useRecordMessageThread } from '../hooks/useRecordMessageThread';

import { EditCardContainer } from './EditCardContainer';

import type { FC, ReactElement } from 'react';

import type { RecordMessageEntry } from '@antica/contracts';

/** outline of the message opened from the record's change history */
const focusedRowStyle = {
  borderColor: colors.jade,
  borderWidth: 2,
  borderRadius: 12,
  paddingHorizontal: 8,
} as const;

/** properties for a record's message area */
export type RecordMessagesContainerProps = {
  recordId: string;
  /** message to scroll to and mark, when opened from the record's change history */
  messageId?: string;
};

/**
 * shows a record's conversation with the assistant, its edit cards, and the composer
 * @param props screen properties
 * @param props.recordId record the conversation is about
 * @param props.messageId message to scroll to and mark, if any
 * @returns the conversation thread above a composer, inside the record's screen frame
 */
export const RecordMessagesContainer: FC<RecordMessagesContainerProps> = ({
  recordId,
  messageId,
}) => {
  const { api } = useAuth();
  const { t } = useLocale();
  const record = useQuery(recordQuery(api, recordId));
  const thread = useRecordMessageThread(api, recordId);
  const composer = useMessageComposer({
    api,
    recordId,
    record: record.data,
    t,
  });
  const { send, voice } = composer;
  const cards = useEditCardStates();
  const newestFirst = [...thread.entries].reverse();
  const focus = useMessageFocus(messageId, newestFirst);

  const renderEntry = ({
    item,
  }: {
    item: RecordMessageEntry;
  }): ReactElement => (
    <View
      testID={`record-message-row-${item.id}`}
      style={[
        { gap: 8, paddingVertical: 6 },
        item.id === messageId && focusedRowStyle,
      ]}>
      {item.id === messageId && (
        <Text testID="record-messages-opened-from-history" style={styles.label}>
          {t('openedFromHistory')}
        </Text>
      )}
      <MessageBubble
        messageId={item.id}
        author={item.author}
        authorLabel={t(
          item.author === 'collector'
            ? 'messageFromYou'
            : 'messageFromAssistant',
        )}
        body={item.body}
      />
      {item.author === 'collector' &&
        (item.draft.status === 'pending' || item.draft.status === 'failed') && (
          <ReplyStatus
            messageId={item.id}
            status={item.draft.status}
            stillWorking={thread.stillWorkingIds.has(item.id)}
            onSendAgain={
              composer.canRestore
                ? () => composer.restore(item.body)
                : undefined
            }
          />
        )}
      {item.author === 'assistant' && <KnowledgeEvidenceCard message={item} />}
      {item.author === 'assistant' && item.draft.proposedChanges.length > 0 && (
        <EditCardContainer
          recordId={recordId}
          entry={item}
          recordRevision={record.data?.recordRevision}
          state={cards.stateOf(item.editDraftId)}
          update={cards.updaterOf(item.editDraftId)}
        />
      )}
    </View>
  );

  return (
    <Screen
      title={t('messages')}
      subtitle={record.data?.name ?? record.data?.code}
      scrollable={false}>
      <View style={{ flex: 1, paddingHorizontal: 16 }}>
        <QueryState
          loading={thread.loading}
          error={thread.error}
          retry={thread.retry}>
          {newestFirst.length === 0 ? (
            <Text
              testID="record-messages-empty"
              style={[styles.secondary, { paddingVertical: 24 }]}>
              {t('noMessages')}
            </Text>
          ) : (
            <FlatList
              testID="record-messages-thread"
              ref={focus.listRef}
              onScrollToIndexFailed={focus.onScrollToIndexFailed}
              inverted
              data={newestFirst}
              keyExtractor={(item) => item.id}
              renderItem={renderEntry}
              keyboardShouldPersistTaps="handled"
              // reading back through the thread closes the keyboard and returns its space (I17)
              keyboardDismissMode="on-drag"
              onEndReached={thread.loadOlder}
              onEndReachedThreshold={0.2}
              contentContainerStyle={{ paddingVertical: 12 }}
              ListFooterComponent={
                thread.hasOlder ? (
                  <View style={{ paddingVertical: 8 }}>
                    {thread.loadingOlder ? (
                      <ActivityIndicator
                        accessibilityLabel={t('loading')}
                        color={colors.jade}
                      />
                    ) : (
                      <MessageButton
                        label={t('earlierMessages')}
                        testID="record-messages-load-earlier"
                        onPress={thread.loadOlder}
                        secondary
                      />
                    )}
                  </View>
                ) : null
              }
            />
          )}
        </QueryState>
      </View>
      <RelatedKnowledgeContainer
        recordId={recordId}
        recordRevision={record.data?.recordRevision}
        onAttach={composer.attach}
        attachments={composer.attachments.map((item) => item.reference)}
        busy={composer.busy}
      />
      <MessageComposer
        hint={composer.hint}
        attachments={composer.attachments}
        onRemoveAttachment={composer.removeAttachment}
        busy={composer.busy}
        text={composer.text}
        onChangeText={composer.setText}
        onSend={send && (() => void send())}
        voicePhase={voice.phase}
        onVoice={
          voice.phase === 'recording'
            ? () => void voice.stop()
            : voice.phase === 'transcribing' || composer.busy
              ? undefined
              : () => void voice.start()
        }
        error={composer.error}
      />
    </Screen>
  );
};
