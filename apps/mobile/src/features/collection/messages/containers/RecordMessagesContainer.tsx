import { useQuery } from '@tanstack/react-query';

import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Text,
  View,
} from 'react-native';

import { colors, styles } from '@antica/ui';

import { QueryState } from '../../../../components/QueryState';
import { Screen } from '../../../../components/Screen';
import { useLocale } from '../../../../i18n/LocaleProvider';
import { useAuth } from '../../../../providers/AuthProvider';

import { recordQuery } from '../../api/record-query';

import { MessageBubble } from '../components/MessageBubble';
import { MessageButton } from '../components/MessageButton';
import { MessageComposer } from '../components/MessageComposer';
import { ReplyStatus } from '../components/ReplyStatus';
import { useEditCardStates } from '../hooks/useEditCardStates';
import { useMessageComposer } from '../hooks/useMessageComposer';
import { useRecordMessageThread } from '../hooks/useRecordMessageThread';
import { useResend } from '../hooks/useResend';

import { EditCardContainer } from './EditCardContainer';

import type { FC, ReactElement } from 'react';

import type { RecordMessageEntry } from '@antica/contracts';

/** properties for a record's message area */
export type RecordMessagesContainerProps = { recordId: string };

/**
 * shows a record's conversation with the assistant, its edit cards, and the composer
 * @param props screen properties
 * @param props.recordId record the conversation is about
 * @returns the conversation thread above a composer, inside the record's screen frame
 */
export const RecordMessagesContainer: FC<RecordMessagesContainerProps> = ({
  recordId,
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
  const { resend, stateOf: resendOf } = useResend({
    api,
    recordId,
    record: record.data,
    t,
  });
  const cards = useEditCardStates();
  const newestFirst = [...thread.entries].reverse();

  /**
   * offers to post a failed message again while no resend of it is in flight or accepted
   * @param entry failed collector message
   * @returns the action, or undefined while it is unavailable
   */
  const sendAgainFor = (entry: RecordMessageEntry): (() => void) | undefined =>
    resend &&
    resendOf(entry.id)?.status !== 'sending' &&
    resendOf(entry.id)?.status !== 'accepted'
      ? () => void resend(entry)
      : undefined;

  const renderEntry = ({
    item,
  }: {
    item: RecordMessageEntry;
  }): ReactElement => (
    <View style={{ gap: 8, paddingVertical: 6 }}>
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
            error={resendOf(item.id)?.error ?? ''}
            onSendAgain={sendAgainFor(item)}
          />
        )}
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
      <KeyboardAvoidingView
        behavior={Platform.select({ ios: 'padding' as const })}
        style={{ flex: 1 }}>
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
                inverted
                data={newestFirst}
                keyExtractor={(item) => item.id}
                renderItem={renderEntry}
                keyboardShouldPersistTaps="handled"
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
        <MessageComposer
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
      </KeyboardAvoidingView>
    </Screen>
  );
};
