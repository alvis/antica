import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useRef, useState } from 'react';

import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  actionResolutionRequestSchema,
  actionResolutionResultSchema,
  applyAnalysisChangesSchema,
  checkCreateSchema,
  mediaDetailSchema,
  recordCheckSchema,
  recordDetailSchema,
} from '@antica/contracts';
import { ActionButton, styles, theme } from '@antica/ui';

import { jobStatusQuery } from '../../../adapters/transcription';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useKnowledgeTitles } from '../../../hooks/useKnowledgeTitles';
import { localizeProposalField } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';
import { formatMonthDayTime } from '../../../utils/calendar';
import { proposalValueText } from '../../../utils/proposal-value';

import { recordQuery } from '../../collection/api/record-query';
import { RecordSegmentScreen } from '../../collection/components/RecordSegmentScreen';
import { RecordSegmentHeaderContainer } from '../../collection/containers/RecordSegmentHeaderContainer';

import { actionCaptureHref } from '../action-capture-href';
import { analysisRunQuery } from '../api/analysis-run-query';
import { AnalysisDetails } from '../components/AnalysisDetails';
import { NextStepCard } from '../components/NextStepCard';
import { SuggestionCard } from '../components/SuggestionCard';
import { useCitedEntries } from '../hooks/useCitedEntries';
import { useProposalFocus } from '../hooks/useProposalFocus';
import { currentFieldValue, runSuggestions } from '../suggestions';

import type { FC } from 'react';

import type {
  ActionState,
  AnalysisRunDetail,
  NextAction,
  RecordDetail,
} from '@antica/contracts';

import type { LocaleState } from '../../../providers/LocaleProvider';

import type { AskContext } from '../../assistant/ask-context';

import type { ReferenceKind } from '../components/AnalysisDetails';
import type { CitedEntry } from '../hooks/useCitedEntries';

export type AnalysisContainerProps = {
  runId: string;
  /** proposal to scroll to and mark, when opened from a record's change history */
  proposalId?: string;
};

const layout = StyleSheet.create({
  content: { paddingBottom: theme.space[24] },
  intro: {
    ...theme.type.body2,
    color: theme.color.text.secondary,
    paddingTop: 14,
    paddingHorizontal: theme.space.page,
    paddingBottom: theme.space[4],
  },
  introStrong: {
    ...theme.font.face('sans', '700'),
    color: theme.color.text.primary,
  },
  sectionHeading: {
    ...theme.type.section,
    color: theme.color.text.primary,
    paddingTop: theme.space.section,
    paddingHorizontal: theme.space.page,
  },
  notice: {
    ...theme.type.body2,
    color: theme.color.text.secondary,
    paddingTop: theme.space[16],
    paddingHorizontal: theme.space.page,
  },
  inset: {
    paddingHorizontal: theme.space.page,
    paddingTop: theme.space[16],
    gap: theme.space[12],
  },
  toggle: {
    minHeight: theme.size.hitMin,
    justifyContent: 'center',
    alignSelf: 'flex-start',
    marginHorizontal: theme.space.page,
    marginTop: theme.space[16],
  },
  toggleText: {
    ...theme.type.body2,
    ...theme.font.face('sans', '600'),
    color: theme.color.accent.default,
  },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[12],
    paddingVertical: theme.space[12],
    paddingHorizontal: theme.space.page,
    backgroundColor: theme.color.bg.dock,
    borderTopWidth: theme.border.hairline.width,
    borderTopColor: theme.border.hairline.color,
  },
  dockInfo: { flex: 1 },
  dockTitle: {
    ...theme.font.face('sans', '700'),
    fontSize: 14,
    lineHeight: 18.9,
    color: theme.color.text.primary,
  },
  dockHint: {
    ...theme.font.face('sans', '400'),
    fontSize: 13,
    lineHeight: 18.9,
    color: theme.color.text.tertiary,
  },
  error: {
    ...styles.error,
    paddingHorizontal: theme.space.page,
    paddingTop: theme.space[12],
  },
});

/**
 * attaches the suggestion the collector is looking at, with its evidence, else the run's record
 * @param run the loaded analysis run, if any
 * @param proposalId the focused or first ticked suggestion
 * @param t translator for the field name
 * @returns what the assistant pill attaches
 */
function analysisAskContext(
  run: AnalysisRunDetail | undefined,
  proposalId: string | undefined,
  t: LocaleState['t'],
): AskContext {
  if (!run) {
    return { kind: 'none' };
  }
  const output = run.result.output;
  const change = output?.proposedChanges.find((item) => item.id === proposalId);
  if (!output || !change) {
    return { kind: 'record', recordId: run.recordId };
  }

  return {
    kind: 'suggestion',
    recordId: run.recordId,
    field: localizeProposalField(change.field, t),
    evidence: output.findings
      .filter((finding) => change.findingIds.includes(finding.id))
      .map((finding) => finding.text),
  };
}

/**
 * the 建議 segment (v5 `suggestions`): each field suggestion with an empty tick, 討論這項, the next
 * steps the analysis asks for, the full analysis on demand, and a dock that writes only the ticked
 * suggestions before showing the change history
 * @param props screen properties
 * @param props.runId the analysis run whose suggestions are shown
 * @param props.proposalId the suggestion opened from the change history, if any
 * @returns the segment
 */
export const AnalysisContainer: FC<AnalysisContainerProps> = ({
  runId,
  proposalId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t, locale } = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [actionText, setActionText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [details, setDetails] = useState(false);
  const checkRequestKeys = useRef(new Map<string, string>());
  const applyRequestKeys = useRef(new Map<string, string>());
  const run = useQuery(analysisRunQuery(api, runId));
  const recordId = run.data?.recordId;
  const record = useQuery({
    ...recordQuery(api, recordId ?? ''),
    enabled: Boolean(recordId),
  });
  // the record's arrival moves the suggestions, so the scroll waits for it
  const focus = useProposalFocus(Boolean(record.data));
  const media = useQueries({
    queries: (run.data?.snapshot.assetIds ?? []).map((id) => ({
      queryKey: ['media', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        api.get(`/v1/media/${id}`, mediaDetailSchema, signal),
    })),
  });
  const finished =
    run.data?.status === 'completed' || run.data?.status === 'partial';
  // the run carries no completion time; its job does
  const job = useQuery({
    ...jobStatusQuery(api, run.data?.jobId ?? null),
    enabled: finished,
  });
  const cited = useCitedEntries(recordId, record.data?.recordRevision);
  const output = run.data?.result.output;
  const title = useKnowledgeTitles(
    (output?.proposedChanges ?? []).flatMap((change) =>
      change.field === 'materialIds' || change.field === 'categoryIds'
        ? [
            ...change.before,
            ...change.proposed,
            ...(record.data?.[change.field] ?? []),
          ]
        : [],
    ),
  );
  const listed = run.data
    ? runSuggestions(
        run.data,
        record.data,
        media.flatMap((item) => (item.data ? [item.data] : [])),
      )
    : [];
  // stale suggestions, which can no longer be applied, follow the rest (v5). The order is fixed once
  // the record is first read: a card that moves while 套用 hands over to 紀錄 makes Android's renderer
  // insert a view that still has a parent, so cards never move after that
  const order = useRef<readonly string[]>(undefined);
  if (!order.current && record.data && listed.length > 0) {
    order.current = [
      ...listed.filter((item) => item.state !== 'stale'),
      ...listed.filter((item) => item.state === 'stale'),
    ].map((item) => item.change.id);
  }
  const rank = (id: string): number => {
    const index = order.current?.indexOf(id) ?? -1;

    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  const suggestions = [...listed].sort(
    (left, right) => rank(left.change.id) - rank(right.change.id),
  );
  const openIds = new Set(
    suggestions
      .filter((suggestion) => suggestion.state === 'open')
      .map((suggestion) => suggestion.change.id),
  );
  // a tick on a suggestion that went stale or was decided elsewhere no longer counts
  const ticked = selected.filter((id) => openIds.has(id));
  const staleSelection = suggestions.filter(
    ({ change, state }) => state === 'stale' && selected.includes(change.id),
  );
  const recordPath = recordId
    ? `/collection/${encodeURIComponent(recordId)}`
    : '';

  const openEvidence = (assetId: string, anchorId: string): void => {
    router.push(`/media/${assetId}?anchorId=${anchorId}`);
  };

  const openReference = (kind: ReferenceKind, id: string): void => {
    if (kind === 'evidence') {
      const detail = media.find((item) =>
        item.data?.anchors.some((anchor) => anchor.id === id),
      )?.data;
      if (detail) {
        openEvidence(detail.asset.id, id);
      } else {
        setError(t('sourceNeedsReview'));
      }
    } else if (kind === 'observation') {
      router.push(`${recordPath}?observationId=${id}`);
    } else {
      const citation = run.data?.citations.find((item) => item.id === id);
      if (!citation) {
        setError(t('sourceNeedsReview'));
      } else if (citation.locator.kind === 'page') {
        router.push(
          `/sources/${citation.locator.sourceId}?versionId=${citation.locator.sourceVersionId}&pageId=${citation.locator.pageId}`,
        );
      } else {
        void Linking.openURL(citation.locator.url);
      }
    }
  };

  const openExample = (example: CitedEntry): void => {
    router.push(
      `/knowledge/${example.entryId}?view=revision&revision=${example.revision}`,
    );
  };

  // the apply button is enabled only with the current record, a tick, and no save in flight
  const apply = async (loaded: RecordDetail): Promise<void> => {
    if (busy || ticked.length === 0) {
      return;
    }
    const selectedProposalIds = [...ticked].sort();
    const identity = JSON.stringify([
      runId,
      loaded.recordRevision,
      selectedProposalIds,
    ]);
    const requestKey = applyRequestKeys.current.get(identity) ?? randomUUID();
    applyRequestKeys.current.set(identity, requestKey);
    setBusy(true);
    setError('');
    try {
      const request = applyAnalysisChangesSchema.parse({
        expectedRecordRevision: loaded.recordRevision,
        selectedProposalIds,
      });
      await api.post(`/v1/analyses/${runId}/apply`, recordDetailSchema, {
        body: request,
        idempotencyKey: requestKey,
      });
      // the record key prefix also refreshes the record's change history
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['record', loaded.id] }),
        queryClient.invalidateQueries({ queryKey: ['analysis', runId] }),
      ]);
      setSelected([]);
      // 套用 then shows what it wrote, in place of the 建議 segment
      router.replace(`${recordPath}/history`);
    } catch (cause) {
      const failure = cause as Error;
      const conflict = 'status' in failure && failure.status === 409;
      setError(conflict ? t('conflict') : failure.message);
      if (conflict) {
        await record.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  // the resolution buttons are enabled only with the record loaded and no save in flight
  const resolveAction = async (
    loaded: RecordDetail,
    actionId: string,
    state: ActionState,
    status: 'supplied' | 'dismissed',
  ): Promise<void> => {
    const note =
      (actionText as Partial<Record<string, string>>)[actionId]?.trim() ?? '';
    if (!note) {
      setError(t('reasonRequired'));

      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = actionResolutionRequestSchema.parse(
        status === 'supplied'
          ? {
              status,
              expectedActionRevision: state.revision,
              expectedRecordRevision: loaded.recordRevision,
              support: { onSiteDescription: note },
            }
          : {
              status,
              expectedActionRevision: state.revision,
              expectedRecordRevision: loaded.recordRevision,
              reason: note,
            },
      );
      await api.patch(
        `/v1/analyses/${runId}/actions/${actionId}`,
        actionResolutionResultSchema,
        { body: request, idempotencyKey: randomUUID() },
      );
      await queryClient.invalidateQueries({ queryKey: ['analysis', runId] });
      await record.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const createCheck = async (
    methodId: string,
    methodVersionId: string,
  ): Promise<void> => {
    if (!record.data || busy) {
      return;
    }
    const requestKey = checkRequestKeys.current.get(methodId) ?? randomUUID();
    checkRequestKeys.current.set(methodId, requestKey);
    setBusy(true);
    setError('');
    try {
      const request = checkCreateSchema.parse({
        expectedRecordRevision: record.data.recordRevision,
        methodId,
        methodVersionId,
        suggestedByRunId: runId,
      });
      const check = await api.post(
        `/v1/records/${record.data.id}/checks`,
        recordCheckSchema,
        { body: request, idempotencyKey: requestKey },
      );
      await queryClient.invalidateQueries({
        queryKey: ['record', record.data.id],
      });
      router.push(`/checks/${check.id}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const actionHref = (action: NextAction, mode: 'photo' | 'describe'): string =>
    actionCaptureHref({ recordId: recordId ?? '', runId, action }, mode);

  const askContext = analysisAskContext(run.data, proposalId ?? ticked[0], t);

  if (!run.data || !recordId) {
    return (
      <Screen title={t('recordSegSuggestions')} askContext={askContext}>
        <QueryState
          loading={run.isPending}
          error={run.error}
          retry={() => void run.refetch()}>
          {null}
        </QueryState>
      </Screen>
    );
  }

  const loadedRun = run.data;
  const completedAt =
    job.data?.state.kind === 'succeeded'
      ? job.data.state.completedAt
      : undefined;
  const subtitle =
    loadedRun.status === 'queued' || loadedRun.status === 'running'
      ? t('suggestionsRunning')
      : loadedRun.status === 'failed'
        ? t('failed')
        : completedAt
          ? t('suggestionsAnalysedAt', {
              when: formatMonthDayTime(completedAt, locale),
            })
          : undefined;
  const pendingActions = (output?.nextActions ?? []).filter(
    (action) =>
      (loadedRun.result.actionStates.find((item) => item.actionId === action.id)
        ?.status ?? 'pending') === 'pending',
  );
  const valueText = (
    change: (typeof suggestions)[number]['change'],
    value: (typeof suggestions)[number]['change']['before'],
  ): string => proposalValueText(change, value, locale, t, title);

  return (
    <RecordSegmentScreen
      testID="analysis-suggestions"
      header={
        <RecordSegmentHeaderContainer
          recordId={recordId}
          current="suggestions"
          subtitle={subtitle}
          askContext={askContext}
        />
      }
      footer={
        suggestions.length > 0 && (
          <View testID="analysis-dock" style={layout.dock}>
            <View style={layout.dockInfo} accessibilityLiveRegion="polite">
              <Text style={layout.dockTitle}>
                {ticked.length > 0
                  ? t('suggestionsTicked', { count: ticked.length })
                  : t('suggestionsNoneTicked')}
              </Text>
              <Text style={layout.dockHint}>
                {ticked.length > 0
                  ? t('suggestionsWriteOnPress')
                  : t('suggestionsTickEach')}
              </Text>
            </View>
            <ActionButton
              testID="analysis-apply"
              label={t('suggestionsApply', { count: ticked.length })}
              onPress={() => record.data && void apply(record.data)}
              disabled={busy || ticked.length === 0 || !record.data}
            />
          </View>
        )
      }>
      <ScrollView
        ref={focus.scrollRef}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={layout.content}>
        {(loadedRun.status === 'queued' || loadedRun.status === 'running') && (
          <View style={layout.inset}>
            <Text style={styles.body}>{t('jobResumes')}</Text>
            <ActionButton
              secondary
              testID="analysis-open-chat"
              label={t('suggestionsFollowInChat')}
              onPress={() => router.replace(`${recordPath}/messages`)}
            />
          </View>
        )}
        {loadedRun.status === 'failed' && (
          <Text accessibilityRole="alert" style={layout.notice}>
            {t('analysisFailed')}
          </Text>
        )}
        {record.data?.analysisInputVersion !==
          loadedRun.snapshot.analysisInputVersion &&
          record.data && <Text style={layout.notice}>{t('newEvidence')}</Text>}
        {staleSelection.length > 0 && (
          <View testID="analysis-selection-conflict" style={layout.inset}>
            <Text accessibilityRole="alert" style={layout.error}>
              {staleSelection
                .map(({ change }) => localizeProposalField(change.field, t))
                .join(' · ')}
              {'：'}
              {t('changeStale')}
            </Text>
            <Text style={layout.notice}>{t('conflict')}</Text>
          </View>
        )}
        {suggestions.length > 0 && (
          <Text style={layout.intro}>
            {t('suggestionsIntroStart')}
            <Text style={layout.introStrong}>
              {t('suggestionsIntroStrong')}
            </Text>
            {t('suggestionsIntroEnd')}
          </Text>
        )}
        <View
          testID="analysis-proposals"
          accessibilityRole="list"
          accessibilityLabel={t('suggestionsGroupLabel')}
          onLayout={proposalId ? focus.onSectionLayout : undefined}>
          {suggestions.map((suggestion) => {
            const { change } = suggestion;
            const focused = change.id === proposalId;
            const example = suggestion.citationIds
              .map((id) => cited.get(id))
              .find((entry) => entry !== undefined);

            return (
              <View
                key={change.id}
                onLayout={focused ? focus.onProposalLayout : undefined}>
                <SuggestionCard
                  suggestion={suggestion}
                  beforeText={valueText(change, change.before)}
                  proposedText={valueText(change, change.proposed)}
                  currentText={
                    record.data
                      ? valueText(
                          change,
                          currentFieldValue(record.data, change.field),
                        )
                      : ''
                  }
                  example={example}
                  checked={ticked.includes(change.id)}
                  canTick={Boolean(record.data) && !busy}
                  focused={focused}
                  onToggle={() =>
                    setSelected((current) =>
                      current.includes(change.id)
                        ? current.filter((id) => id !== change.id)
                        : [...current, change.id],
                    )
                  }
                  onDiscuss={() =>
                    router.replace(
                      `${recordPath}/messages?runId=${encodeURIComponent(runId)}&proposalId=${encodeURIComponent(change.id)}`,
                    )
                  }
                  onOpenPhoto={openEvidence}
                  onOpenExample={openExample}
                />
              </View>
            );
          })}
        </View>
        {pendingActions.length > 0 && (
          <>
            <Text accessibilityRole="header" style={layout.sectionHeading}>
              {t('suggestionsNextSteps')}
            </Text>
            {pendingActions.map((action) => {
              const measuring = /尺|測量|\b(ruler|scale|measure)\b/i.test(
                action.instruction,
              );
              const photoUri =
                action.kind === 'capturePhoto' && !measuring
                  ? media
                      .find((item) => item.data?.asset.kind === 'photo')
                      ?.data?.reads.at(0)?.url
                  : undefined;

              return (
                <NextStepCard
                  key={action.id}
                  testID={`analysis-next-${action.id}`}
                  title={action.instruction}
                  reason={action.reason}
                  icon={
                    action.kind === 'describe'
                      ? 'edit'
                      : measuring
                        ? 'ruler'
                        : 'camera'
                  }
                  photoUri={photoUri}
                  onPress={() =>
                    router.push(
                      actionHref(
                        action,
                        action.kind === 'describe' ? 'describe' : 'photo',
                      ),
                    )
                  }
                />
              );
            })}
          </>
        )}
        {output && (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: details }}
            testID="analysis-details-toggle"
            onPress={() => setDetails((current) => !current)}
            style={layout.toggle}>
            <Text style={layout.toggleText}>
              {details
                ? t('suggestionsHideDetails')
                : t('suggestionsShowDetails')}
            </Text>
          </Pressable>
        )}
        {details && (
          <View style={layout.inset}>
            <AnalysisDetails
              run={loadedRun}
              actionText={actionText}
              onActionTextChange={(actionId, value) =>
                setActionText((current) => ({ ...current, [actionId]: value }))
              }
              busy={busy}
              canResolve={Boolean(record.data)}
              onReference={openReference}
              onStartCheck={(methodId, methodVersionId) =>
                void createCheck(methodId, methodVersionId)
              }
              onViewMethod={(entryId, methodVersionId) =>
                router.push(
                  `/knowledge/${entryId}?methodVersionId=${methodVersionId}`,
                )
              }
              onCapture={(actionId) => {
                const action = output?.nextActions.find(
                  (item) => item.id === actionId,
                );
                if (action) {
                  router.push(actionHref(action, 'photo'));
                }
              }}
              onDescribe={(actionId) => {
                const action = output?.nextActions.find(
                  (item) => item.id === actionId,
                );
                if (action) {
                  router.push(actionHref(action, 'describe'));
                }
              }}
              onOpenCheck={(checkId) => router.push(`/checks/${checkId}`)}
              onResolve={(actionId, state, status) =>
                record.data &&
                void resolveAction(record.data, actionId, state, status)
              }
            />
            <ActionButton
              label={t('addEvidence')}
              onPress={() => router.push(`/capture?recordId=${recordId}`)}
              secondary
            />
          </View>
        )}
        {Boolean(error) && (
          <Text accessibilityRole="alert" style={layout.error}>
            {error}
          </Text>
        )}
      </ScrollView>
    </RecordSegmentScreen>
  );
};
