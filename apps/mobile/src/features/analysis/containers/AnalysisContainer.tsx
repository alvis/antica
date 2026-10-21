import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useRef, useState } from 'react';

import { Linking, Pressable, Text, View } from 'react-native';

import {
  actionResolutionRequestSchema,
  actionResolutionResultSchema,
  applyAnalysisChangesSchema,
  checkCreateSchema,
  mediaDetailSchema,
  recordCheckSchema,
  recordDetailSchema,
  isProposalCurrent,
} from '@antica/contracts';
import { ActionButton, colors, styles } from '@antica/ui';

import { ProposalValues } from '../../../components/ProposalValues';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { localizeProposalField, localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { actionCaptureHref } from '../action-capture-href';
import { analysisRunQuery } from '../api/analysis-run-query';
import { ActionCard } from '../components/ActionCard';
import { useProposalFocus } from '../hooks/useProposalFocus';

import type { FC } from 'react';

import type { LayoutChangeEvent } from 'react-native';

import type {
  ActionState,
  AnalysisRunDetail,
  Finding,
  ProposedChange,
} from '@antica/contracts';

import type { MessageKey } from '../../../i18n/messages';
import type { LocaleState } from '../../../providers/LocaleProvider';

import type { AskContext } from '../../assistant/ask-context';

export type AnalysisContainerProps = {
  runId: string;
  /** proposal to scroll to and mark, when opened from a record's change history */
  proposalId?: string;
};
type ReferenceKind = 'evidence' | 'observation' | 'citation';

/** button label of each kind of finding reference, followed by a short ID */
const referenceLabelKeys = {
  evidence: 'evidenceWithId',
  observation: 'observationWithId',
  citation: 'citationWithId',
} as const satisfies Record<ReferenceKind, MessageKey>;

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

export const AnalysisContainer: FC<AnalysisContainerProps> = ({
  runId,
  proposalId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [actionText, setActionText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [applied, setApplied] = useState(false);
  const checkRequestKeys = useRef(new Map<string, string>());
  const run = useQuery(analysisRunQuery(api, runId));
  const record = useQuery({
    queryKey: ['record', run.data?.recordId],
    enabled: Boolean(run.data?.recordId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/records/${run.data?.recordId}`, recordDetailSchema, signal),
  });
  // the record's arrival moves the proposals, so the scroll waits for it
  const focus = useProposalFocus(Boolean(record.data));
  const media = useQueries({
    queries: (run.data?.snapshot.assetIds ?? []).map((id) => ({
      queryKey: ['media', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        api.get(`/v1/media/${id}`, mediaDetailSchema, signal),
    })),
  });

  const openEvidence = (id: string): void => {
    const detail = media.find((item) =>
      item.data?.anchors.some((anchor) => anchor.id === id),
    )?.data;
    if (detail) {
      router.push(`/media/${detail.asset.id}?anchorId=${id}`);
    } else {
      setError(t('sourceNeedsReview'));
    }
  };

  const openCitation = (id: string): void => {
    const citation = run.data?.citations.find((item) => item.id === id);
    if (!citation) {
      setError(t('sourceNeedsReview'));

      return;
    }
    if (citation.locator.kind === 'page') {
      router.push(
        `/sources/${citation.locator.sourceId}?versionId=${citation.locator.sourceVersionId}&pageId=${citation.locator.pageId}`,
      );
    } else {
      void Linking.openURL(citation.locator.url);
    }
  };

  const openReference = (kind: ReferenceKind, id: string): void => {
    if (kind === 'evidence') {
      openEvidence(id);
    } else if (kind === 'observation') {
      router.push(`/collection/${run.data?.recordId}?observationId=${id}`);
    } else {
      openCitation(id);
    }
  };

  type LoadedRecord = NonNullable<typeof record.data>;

  // the apply button is enabled only with the current record, a selection, and no save in flight
  const apply = async (loaded: LoadedRecord): Promise<void> => {
    setBusy(true);
    setError('');
    setApplied(false);
    try {
      const request = applyAnalysisChangesSchema.parse({
        expectedRecordRevision: loaded.recordRevision,
        selectedProposalIds: selected.filter((id) => {
          const proposal = run.data?.result.output?.proposedChanges.find(
            (change) => change.id === id,
          );
          return proposal && isProposalCurrent(loaded, proposal);
        }),
      });
      await api.post(`/v1/analyses/${runId}/apply`, recordDetailSchema, {
        body: request,
        idempotencyKey: randomUUID(),
      });
      // the record key prefix also refreshes the record's change history
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['record', loaded.id] }),
        queryClient.invalidateQueries({ queryKey: ['analysis', runId] }),
        // a decided suggestion no longer names related knowledge
        queryClient.invalidateQueries({
          queryKey: ['record-related-knowledge'],
        }),
      ]);
      setSelected([]);
      setApplied(true);
    } catch (cause) {
      const failure = cause as Error;
      setError(
        'status' in failure && failure.status === 409
          ? t('conflict')
          : failure.message,
      );
      if ('status' in failure && failure.status === 409) {
        await record.refetch();
      }
    } finally {
      setBusy(false);
    }
  };

  // the resolution buttons are enabled only with the record loaded and no save in flight
  const resolveAction = async (
    loaded: LoadedRecord,
    actionId: string,
    state: ActionState,
    status: 'supplied' | 'dismissed',
  ): Promise<void> => {
    const revision = state.revision;
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
              expectedActionRevision: revision,
              expectedRecordRevision: loaded.recordRevision,
              support: { onSiteDescription: note },
            }
          : {
              status,
              expectedActionRevision: revision,
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

  const output = run.data?.result.output;
  const askContext = analysisAskContext(run.data, proposalId ?? selected[0], t);

  return (
    <Screen
      title={t('results')}
      askContext={askContext}
      scrollRef={focus.scrollRef}
      subtitle={
        run.data
          ? t('runStatusVersion', {
              status: localizeStatus(run.data.status, t),
              version: run.data.snapshot.analysisInputVersion,
            })
          : undefined
      }>
      <QueryState
        loading={run.isPending}
        error={run.error}
        retry={() => void run.refetch()}>
        {run.data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>
                {run.data.status === 'partial'
                  ? t('partial')
                  : run.data.status === 'completed'
                    ? t('saved')
                    : run.data.status === 'failed'
                      ? t('failed')
                      : t('processing')}
              </Text>
              {['queued', 'running'].includes(run.data.status) && (
                <Text style={styles.body}>{t('jobResumes')}</Text>
              )}
              {run.data.status === 'failed' && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {t('analysisFailed')}
                </Text>
              )}
              <ActionButton
                secondary
                testID="analysis-open-record"
                label={t('openRecord')}
                onPress={() => router.push(`/collection/${run.data.recordId}`)}
              />
              {record.data?.analysisInputVersion !==
                run.data.snapshot.analysisInputVersion && (
                <Text style={styles.error}>{t('newEvidence')}</Text>
              )}
              <ActionButton
                label={t('addEvidence')}
                onPress={() =>
                  router.push(`/capture?recordId=${run.data.recordId}`)
                }
                secondary
              />
            </View>
            {output && (
              <>
                <View style={styles.card}>
                  <Text style={styles.heading}>{t('summary')}</Text>
                  <Text style={styles.body}>{output.summary}</Text>
                </View>
                <FindingGroup
                  title={t('photoClues')}
                  findings={output.findings.filter(
                    (finding) => finding.kind === 'visualObservation',
                  )}
                  onReference={openReference}
                />
                <FindingGroup
                  title={t('collectorObservations')}
                  findings={output.findings.filter(
                    (finding) => finding.kind === 'collectorObservation',
                  )}
                  onReference={openReference}
                />
                <FindingGroup
                  title={t('sourceClaims')}
                  findings={output.findings.filter(
                    (finding) => finding.kind === 'sourceStatement',
                  )}
                  onReference={openReference}
                />
                <FindingGroup
                  title={t('hypothesesPendingResearch')}
                  findings={output.findings.filter(
                    (finding) => finding.kind === 'hypothesis',
                  )}
                  onReference={openReference}
                />
                {output.uncertainties.length > 0 && (
                  <View style={styles.card}>
                    <Text style={styles.heading}>{t('uncertainties')}</Text>
                    {output.uncertainties.map((value, index) => (
                      <Text key={index} style={styles.body}>
                        {value}
                      </Text>
                    ))}
                  </View>
                )}
                <View style={styles.card}>
                  <Text style={styles.heading}>{t('tasks')}</Text>
                  {run.data.suggestedMethods.map((method) => (
                    <View key={method.methodId} style={styles.card}>
                      <Text style={styles.body}>{method.titleZhHant}</Text>
                      <ActionButton
                        label={t('startCheck')}
                        onPress={() =>
                          void createCheck(
                            method.methodId,
                            method.methodVersionId,
                          )
                        }
                        disabled={busy}
                        secondary
                      />
                      <ActionButton
                        label={t('viewMethod')}
                        onPress={() =>
                          router.push(
                            `/knowledge/${method.owningEntryId}?methodVersionId=${method.methodVersionId}`,
                          )
                        }
                        secondary
                      />
                    </View>
                  ))}
                  {output.nextActions.map((action) => {
                    const state = run.data.result.actionStates.find(
                      (item) => item.actionId === action.id,
                    );
                    const target = {
                      recordId: run.data.recordId,
                      runId,
                      action,
                    };

                    return (
                      <ActionCard
                        key={action.id}
                        action={action}
                        status={state?.status ?? 'pending'}
                        note={actionText[action.id] ?? ''}
                        onNoteChange={(value) =>
                          setActionText((current) => ({
                            ...current,
                            [action.id]: value,
                          }))
                        }
                        busy={busy}
                        canResolve={Boolean(record.data)}
                        onCapture={() =>
                          router.push(actionCaptureHref(target, 'photo'))
                        }
                        onDescribe={() =>
                          router.push(actionCaptureHref(target, 'describe'))
                        }
                        onOpenCheck={() =>
                          router.push(`/checks/${action.checkId}`)
                        }
                        onResolve={
                          state
                            ? (status) =>
                                void resolveAction(
                                  record.data!,
                                  action.id,
                                  state,
                                  status,
                                )
                            : undefined
                        }
                      />
                    );
                  })}
                </View>
                <View
                  testID="analysis-proposals"
                  style={styles.card}
                  onLayout={proposalId ? focus.onSectionLayout : undefined}>
                  <Text style={styles.heading}>{t('proposal')}</Text>
                  {output.proposedChanges.map((change) => (
                    <ProposalRow
                      key={change.id}
                      change={change}
                      status={
                        (run.data.result.proposalStates.find(
                          (item) => item.proposalId === change.id,
                        )?.status ?? 'pending') === 'pending' &&
                        record.data &&
                        !isProposalCurrent(record.data, change)
                          ? 'stale'
                          : (run.data.result.proposalStates.find(
                              (item) => item.proposalId === change.id,
                            )?.status ?? 'pending')
                      }
                      evidence={output.findings
                        .filter((finding) =>
                          change.findingIds.includes(finding.id),
                        )
                        .map((finding) => finding.text)}
                      checked={selected.includes(change.id)}
                      onFocusLayout={
                        change.id === proposalId
                          ? focus.onProposalLayout
                          : undefined
                      }
                      onToggle={() =>
                        setSelected((current) =>
                          current.includes(change.id)
                            ? current.filter((id) => id !== change.id)
                            : [...current, change.id],
                        )
                      }
                    />
                  ))}
                  <ActionButton
                    label={t('applySelectedCount', {
                      count: selected.length,
                    })}
                    onPress={() => void apply(record.data!)}
                    disabled={busy || selected.length === 0 || !record.data}
                  />
                  {applied && (
                    <>
                      <Text
                        accessibilityRole="alert"
                        accessibilityLiveRegion="polite"
                        style={styles.body}>
                        {t('appliedToRecord')}
                      </Text>
                      <ActionButton
                        secondary
                        testID="analysis-applied-history"
                        label={t('viewChangeHistory')}
                        onPress={() =>
                          router.push(
                            `/collection/${run.data.recordId}/history`,
                          )
                        }
                      />
                    </>
                  )}
                </View>
              </>
            )}
          </>
        )}
      </QueryState>
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};

type FindingGroupProps = {
  title: string;
  findings: Finding[];
  onReference: (kind: ReferenceKind, id: string) => void;
};
const FindingGroup: FC<FindingGroupProps> = ({
  title,
  findings,
  onReference,
}) => {
  const { t } = useLocale();

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>{title}</Text>
      {findings.map((finding) => (
        <View key={finding.id} style={styles.card}>
          <Text style={styles.body}>{finding.text}</Text>
          <Text style={styles.secondary}>
            {t(finding.certainty)} · {t(finding.relation)}
          </Text>
          {[
            ...finding.evidenceIds.map((id) => ({
              id,
              kind: 'evidence' as const,
            })),
            ...finding.observationIds.map((id) => ({
              id,
              kind: 'observation' as const,
            })),
            ...finding.citationIds.map((id) => ({
              id,
              kind: 'citation' as const,
            })),
          ].map(({ id, kind }) => (
            <ActionButton
              key={`${kind}:${id}`}
              label={t(referenceLabelKeys[kind], { id: id.slice(0, 8) })}
              onPress={() => onReference(kind, id)}
              secondary
            />
          ))}
        </View>
      ))}
      {findings.length === 0 && <Text style={styles.secondary}>—</Text>}
    </View>
  );
};

type ProposalRowProps = {
  change: ProposedChange;
  status: 'pending' | 'accepted' | 'skipped' | 'stale';
  evidence: string[];
  checked: boolean;
  /** present only on the proposal opened from a record's change history */
  onFocusLayout?: (event: LayoutChangeEvent) => void;
  onToggle: () => void;
};
const ProposalRow: FC<ProposalRowProps> = ({
  change,
  status,
  evidence,
  checked,
  onFocusLayout,
  onToggle,
}) => {
  const { t } = useLocale();
  const focused = Boolean(onFocusLayout);

  return (
    <Pressable
      testID={`analysis-proposal-${change.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: status !== 'pending' }}
      // the marker is a hint, not a selected state, so it never reads as a preselection
      accessibilityHint={focused ? t('openedFromHistory') : undefined}
      disabled={status !== 'pending'}
      onPress={onToggle}
      onLayout={onFocusLayout}
      style={
        focused
          ? [styles.card, { borderColor: colors.jade, borderWidth: 2 }]
          : styles.card
      }>
      {focused && <Text style={styles.label}>{t('openedFromHistory')}</Text>}
      <Text style={styles.heading}>
        {checked ? '☑' : '☐'} {localizeProposalField(change.field, t)} ·{' '}
        {status === 'stale' ? t('staleSuggestion') : localizeStatus(status, t)}
      </Text>
      <ProposalValues change={change} />
      {change.confidence && (
        <Text style={styles.secondary}>
          {t(
            (
              {
                high: 'confidenceHigh',
                medium: 'confidenceMedium',
                low: 'confidenceLow',
              } as const
            )[change.confidence],
          )}
        </Text>
      )}
      {status === 'stale' && (
        <Text style={styles.secondary}>{t('staleSuggestionReason')}</Text>
      )}
      {evidence.map((value, index) => (
        <Text key={index} style={styles.secondary}>
          {value}
        </Text>
      ))}
    </Pressable>
  );
};
