import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AssistantSeal, styles, theme } from '@antica/ui';

import { jobStatusQuery } from '../../../../adapters/transcription';
import { QueryState } from '../../../../components/QueryState';
import { useKnowledgeTitles } from '../../../../hooks/useKnowledgeTitles';
import { localizeProposalField } from '../../../../i18n/messages';
import { useAuth } from '../../../../providers/AuthProvider';
import { useLocale } from '../../../../providers/LocaleProvider';
import { proposalValueText } from '../../../../utils/proposal-value';

import {
  analysisRunQuery,
  isRunInProgress,
} from '../../../analysis/api/analysis-run-query';
import { useCitedEntries } from '../../../analysis/hooks/useCitedEntries';
import { runSuggestions } from '../../../analysis/suggestions';
import { RelatedKnowledgeContainer } from '../../../knowledge/containers/RelatedKnowledgeContainer';

import { mediaQuery } from '../../api/media-query';
import { RecordSegmentScreen } from '../../components/RecordSegmentScreen';
import { RecordSegmentHeaderContainer } from '../../containers/RecordSegmentHeaderContainer';
import { useRecordHub } from '../../hooks/useRecordHub';

import { AnalysisThreadBlock } from '../components/AnalysisThreadBlock';
import { DiscussCard } from '../components/DiscussCard';
import {
  KnowledgeEvidenceCard,
  AnswerText,
} from '../components/KnowledgeEvidenceCard';
import { MessageBubble } from '../components/MessageBubble';
import { MessageButton } from '../components/MessageButton';
import { MessageComposer } from '../components/MessageComposer';
import { ReplyStatus } from '../components/ReplyStatus';
import { ThreadTime } from '../components/ThreadTime';
import { useEditCardStates } from '../hooks/useEditCardStates';
import { useMessageComposer } from '../hooks/useMessageComposer';
import { useMessageFocus } from '../hooks/useMessageFocus';
import { useRecordMessageThread } from '../hooks/useRecordMessageThread';
import { splitDiscussContext } from '../discuss-context';
import { threadRows } from '../thread-rows';

import { EditCardContainer } from './EditCardContainer';

import type { FC, ReactElement } from 'react';

import type { AnalysisRunDetail } from '@antica/contracts';

import type { CitedEntry } from '../../../analysis/hooks/useCitedEntries';

import type { ThreadAnalysis, ThreadRow } from '../thread-rows';

/** properties for a record's message area */
export type RecordMessagesContainerProps = {
  recordId: string;
  /** message to scroll to and mark, when opened from the record's change history */
  messageId?: string;
  /** unsent question to start the composer with, when opened from the ask sheet */
  draft?: string;
  /** the run whose suggestion 討論這項 attached */
  runId?: string;
  /** the suggestion 討論這項 attached */
  proposalId?: string;
  /** the analysis just started here, which the record names only once it finishes */
  startedRunId?: string;
};

/** a row of the inverted list: the thread's rows, and the attached suggestion waiting to be sent */
type ListRow = ThreadRow | { kind: 'discuss'; id: string };

const layout = StyleSheet.create({
  thread: { flex: 1 },
  // the list is inverted, so flex-end keeps a short thread at the top of the screen
  content: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    padding: theme.space.page,
    gap: theme.space.page,
  },
  ai: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[10] },
  column: { flex: 1, minWidth: 0, gap: theme.space.stack },
  focused: {
    borderColor: theme.color.accent.default,
    borderWidth: 2,
    borderRadius: theme.radius.field,
    padding: theme.space[8],
    gap: theme.space[8],
  },
  empty: { ...styles.secondary, padding: theme.space.page },
  tray: {
    maxHeight: 220,
    paddingHorizontal: theme.space.page,
    paddingTop: theme.space[8],
    borderTopWidth: theme.border.hairline.width,
    borderTopColor: theme.border.hairline.color,
    backgroundColor: theme.color.bg.page,
  },
});

/**
 * where the latest analysis stands in the conversation
 * @param run the latest run, once read
 * @returns the block's phase, or nothing when there is no analysis to show
 */
function analysisPhase(
  run: AnalysisRunDetail | undefined,
): 'queued' | 'running' | 'finished' | 'failed' | undefined {
  if (!run) {
    return undefined;
  }
  if (run.status === 'queued' || run.status === 'running') {
    return run.status;
  }
  if (run.status === 'failed') {
    return 'failed';
  }

  return run.result.output ? 'finished' : undefined;
}

/**
 * the 對話 segment (v5 `messages`, `analysis-running`, `suggestion-discuss`): the conversation with
 * the assistant, its cited answers and edit cards, the latest analysis in line, a suggestion
 * attached by 討論這項, and the composer with voice and the 相關知識 tray
 * @param props screen properties
 * @param props.recordId record the conversation is about
 * @param props.messageId message to scroll to and mark, if any
 * @param props.draft unsent question for the composer, if any
 * @param props.runId the run of the attached suggestion, if any
 * @param props.proposalId the attached suggestion, if any
 * @param props.startedRunId the analysis just started, if any
 * @returns the segment
 */
export const RecordMessagesContainer: FC<RecordMessagesContainerProps> = ({
  recordId,
  messageId,
  draft,
  runId,
  proposalId,
  startedRunId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t, locale } = useLocale();
  const hub = useRecordHub(recordId);
  const record = hub.record;
  const thread = useRecordMessageThread(api, recordId);
  const [relatedOpen, setRelatedOpen] = useState(false);
  // the suggestion 討論這項 attached; a new one arriving on an open thread replaces the last
  const attachedKey =
    runId && proposalId ? `${runId}/${proposalId}` : undefined;
  const [removedKey, setRemovedKey] = useState<string>();
  const [sentKey, setSentKey] = useState<string>();
  const discussing = attachedKey !== undefined && attachedKey !== removedKey;
  const contextSent = attachedKey !== undefined && attachedKey === sentKey;

  // the suggestion 討論這項 attached, with what it rests on
  const discussRun = useQuery({
    ...analysisRunQuery(api, runId ?? ''),
    enabled: Boolean(runId),
  });
  const startedRun = useQuery({
    ...analysisRunQuery(api, startedRunId ?? ''),
    enabled: Boolean(startedRunId),
  });
  const latestRun = startedRun.data ?? hub.run.data;
  const startedFinished =
    startedRun.data !== undefined && !isRunInProgress(startedRun.data.status);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (startedFinished) {
      // the record now names the finished run, so 建議 and its count follow it
      void queryClient.invalidateQueries({ queryKey: ['record', recordId] });
    }
  }, [startedFinished, queryClient, recordId]);
  const runAssets = [
    ...new Set([
      ...(discussRun.data?.snapshot.assetIds ?? []),
      ...(latestRun?.snapshot.assetIds ?? []),
    ]),
  ];
  const media = useQueries({
    queries: runAssets.map((id) => mediaQuery(api, id)),
  });
  const loadedMedia = media.flatMap((item) => (item.data ? [item.data] : []));
  const suggestion =
    discussing && discussRun.data
      ? runSuggestions(discussRun.data, record.data, loadedMedia).find(
          (item) => item.change.id === proposalId,
        )
      : undefined;
  // only the attached suggestion shows museum examples, so read cited entries just while discussing
  const cited = useCitedEntries(
    discussing ? recordId : undefined,
    record.data?.recordRevision,
  );
  const title = useKnowledgeTitles(
    suggestion?.change.field === 'materialIds' ||
      suggestion?.change.field === 'categoryIds'
      ? suggestion.change.proposed
      : [],
  );
  const discussField = suggestion
    ? localizeProposalField(suggestion.change.field, t)
    : '';
  const discussValue = suggestion
    ? proposalValueText(
        suggestion.change,
        suggestion.change.proposed,
        locale,
        t,
        title,
      )
    : '';
  const example: CitedEntry | undefined = suggestion?.citationIds
    .map((id) => cited.get(id))
    .find((entry) => entry !== undefined);

  const composer = useMessageComposer({
    api,
    recordId,
    record: record.data,
    t,
    initialText: draft,
    context:
      suggestion && !contextSent
        ? t('discussContext', { field: discussField, value: discussValue })
        : undefined,
    onContextSent: () => setSentKey(attachedKey),
  });
  const { send, voice } = composer;
  const cards = useEditCardStates();

  // the latest analysis in line: progress while it runs, the way to its suggestions once done
  const phase = analysisPhase(latestRun);
  const job = useQuery({
    ...jobStatusQuery(api, latestRun?.jobId ?? null),
    enabled: Boolean(latestRun),
  });
  const analysis: ThreadAnalysis | undefined =
    latestRun && phase
      ? {
          runId: latestRun.runId,
          phase: phase === 'queued' ? 'running' : phase,
          at:
            phase === 'finished'
              ? job.data?.state.kind === 'succeeded'
                ? job.data.state.completedAt
                : hub.runCompletedAt
              : job.data?.createdAt,
        }
      : undefined;
  const rows = threadRows(thread.entries, suggestion ? undefined : analysis);
  const newestFirst: ListRow[] = [
    ...[...rows].reverse(),
    ...(suggestion && !contextSent
      ? [{ kind: 'discuss' as const, id: 'discuss' }]
      : []),
  ];
  const focus = useMessageFocus(messageId, newestFirst);
  const analysedPhotos = (latestRun?.snapshot.assetIds ?? []).flatMap((id) => {
    const detail = loadedMedia.find((item) => item.asset.id === id);

    return detail?.asset.kind === 'photo' ? [detail.reads.at(0)?.url] : [];
  });

  // a file not read yet counts as a photo, the common case, until its kind is known
  const analysedVideos = (latestRun?.snapshot.assetIds ?? []).filter(
    (id) =>
      loadedMedia.find((item) => item.asset.id === id)?.asset.kind === 'video',
  ).length;
  const analysedCounts = {
    photos: (latestRun?.snapshot.assetIds.length ?? 0) - analysedVideos,
    videos: analysedVideos,
  };

  const openPhoto = (assetId: string, anchorId: string): void =>
    router.push(`/media/${assetId}?anchorId=${anchorId}`);
  const openExample = (entry: CitedEntry): void =>
    router.push(
      `/knowledge/${entry.entryId}?view=revision&revision=${entry.revision}`,
    );

  const subtitle = suggestion
    ? t('discussSubtitle', { field: discussField })
    : phase === 'queued'
      ? t('queued')
      : phase === 'running'
        ? t('analysisRunningSubtitle')
        : messagesSubtitle(hub, t);

  const renderRow = ({ item }: { item: ListRow }): ReactElement => {
    switch (item.kind) {
      case 'time':
        return <ThreadTime at={item.at} />;
      case 'discuss':
        return suggestion ? (
          <DiscussCard
            field={discussField}
            value={discussValue}
            confidence={suggestion.change.confidence}
            photos={suggestion.photos}
            example={example}
            onOpenPhoto={openPhoto}
            onOpenExample={openExample}
          />
        ) : (
          <View />
        );
      case 'analysis':
        return (
          <AnalysisThreadBlock
            phase={phase ?? 'finished'}
            photoUris={analysedPhotos}
            photoCount={analysedCounts.photos}
            videoCount={analysedCounts.videos}
            suggestionCount={
              latestRun?.result.output?.proposedChanges.length ?? 0
            }
            onOpenSuggestions={() =>
              router.replace(
                `/analysis/${encodeURIComponent(item.analysis.runId)}`,
              )
            }
          />
        );
      default:
        return renderMessage(item.entry);
    }
  };

  const renderMessage = (
    entry: Extract<ThreadRow, { kind: 'message' }>['entry'],
  ): ReactElement => {
    const opened = entry.id === messageId;
    const body =
      entry.author === 'collector' ? (
        <>
          <MessageBubble
            messageId={entry.id}
            authorLabel={t('messageFromYou')}
            body={entry.body}
          />
          {(entry.draft.status === 'pending' ||
            entry.draft.status === 'failed') && (
            <ReplyStatus
              messageId={entry.id}
              status={entry.draft.status}
              stillWorking={thread.stillWorkingIds.has(entry.id)}
              onSendAgain={
                composer.canRestore
                  ? () => composer.restore(splitDiscussContext(entry.body).text)
                  : undefined
              }
            />
          )}
        </>
      ) : (
        <View
          testID={`record-message-bubble-${entry.id}`}
          accessibilityLabel={`${t('messageFromAssistant')}: ${entry.body}`}
          style={layout.ai}>
          <AssistantSeal size="voice" />
          <View style={layout.column}>
            <AnswerText message={entry} />
            <KnowledgeEvidenceCard message={entry} />
            {entry.draft.proposedChanges.length > 0 && (
              <EditCardContainer
                recordId={recordId}
                entry={entry}
                record={record.data}
                state={cards.stateOf(entry.editDraftId)}
                update={cards.updaterOf(entry.editDraftId)}
              />
            )}
          </View>
        </View>
      );

    return (
      <View
        testID={`record-message-row-${entry.id}`}
        style={opened ? layout.focused : { gap: theme.space[6] }}>
        {opened && (
          <Text
            testID="record-messages-opened-from-history"
            style={styles.label}>
            {t('openedFromHistory')}
          </Text>
        )}
        {body}
      </View>
    );
  };

  return (
    <RecordSegmentScreen
      testID="record-messages"
      header={
        <RecordSegmentHeaderContainer
          recordId={recordId}
          current="chat"
          subtitle={subtitle}
          askContext={
            suggestion
              ? {
                  kind: 'suggestion',
                  recordId,
                  field: discussField,
                  evidence: suggestion.reasons,
                }
              : undefined
          }
        />
      }
      footer={
        <>
          {relatedOpen && (
            <View style={layout.tray}>
              <RelatedKnowledgeContainer
                recordId={recordId}
                recordRevision={record.data?.recordRevision}
                onAttach={composer.attach}
                attachments={composer.attachments.map((item) => item.reference)}
                busy={composer.busy}
              />
            </View>
          )}
          <MessageComposer
            hint={composer.hint}
            placeholder={t(
              suggestion
                ? 'composerDiscuss'
                : phase === 'queued' || phase === 'running'
                  ? 'composerRunning'
                  : 'composerDefault',
            )}
            attachments={composer.attachments}
            onRemoveAttachment={composer.removeAttachment}
            discussing={
              suggestion
                ? {
                    label: t('discussChip', {
                      field: discussField,
                      value: discussValue,
                    }),
                    onRemove: () => setRemovedKey(attachedKey),
                  }
                : undefined
            }
            busy={composer.busy}
            text={composer.text}
            onChangeText={composer.setText}
            onSend={
              send &&
              (() => {
                // the reply and its card get the room the tray took
                setRelatedOpen(false);
                void send();
              })
            }
            voicePhase={voice.phase}
            onVoice={
              voice.phase === 'recording'
                ? () => void voice.stop()
                : voice.phase === 'transcribing' || composer.busy
                  ? undefined
                  : () => void voice.start()
            }
            onCapture={() =>
              router.push(`/capture?recordId=${encodeURIComponent(recordId)}`)
            }
            relatedOpen={relatedOpen}
            onToggleRelated={() => setRelatedOpen((current) => !current)}
            error={composer.error}
          />
        </>
      }>
      <View style={layout.thread}>
        <QueryState
          loading={thread.loading}
          error={thread.error}
          retry={thread.retry}>
          {newestFirst.length === 0 ? (
            <Text testID="record-messages-empty" style={layout.empty}>
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
              renderItem={renderRow}
              keyboardShouldPersistTaps="handled"
              // reading back through the thread closes the keyboard and returns its space (I17)
              keyboardDismissMode="on-drag"
              onEndReached={thread.loadOlder}
              onEndReachedThreshold={0.2}
              contentContainerStyle={layout.content}
              ListFooterComponent={
                thread.hasOlder ? (
                  <View style={{ paddingVertical: theme.space[8] }}>
                    {thread.loadingOlder ? (
                      <ActivityIndicator
                        accessibilityLabel={t('loading')}
                        color={theme.color.action.primary}
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
    </RecordSegmentScreen>
  );
};

/**
 * the 對話 header's status line: where the object is and how many edit-card rows wait (v5
 * 「書房 · 2 項修改待確認」)
 * @param hub the record's reads
 * @param t translator
 * @returns the line, or nothing while the record loads
 */
function messagesSubtitle(
  hub: ReturnType<typeof useRecordHub>,
  t: ReturnType<typeof useLocale>['t'],
): string | undefined {
  const record = hub.record.data;
  if (!record) {
    return undefined;
  }
  const place = record.location.locationId
    ? hub.fieldLabels.labels.location(record.location.locationId)
    : record.location.detail;
  const waiting =
    hub.editChanges.length > 0
      ? t('messagesEditsWaiting', { count: hub.editChanges.length })
      : undefined;

  return [place, waiting].filter(Boolean).join(' · ') || undefined;
}
