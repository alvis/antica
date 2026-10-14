import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useRef, useState } from 'react';

import { Linking, Pressable, Text, View } from 'react-native';

import {
  actionResolutionRequestSchema,
  actionResolutionResultSchema,
  analysisRunDetailSchema,
  applyAnalysisChangesSchema,
  checkCreateSchema,
  mediaDetailSchema,
  recordCheckSchema,
  recordDetailSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { useAuth } from '../../auth';
import { QueryState } from '../../components/QueryState';
import { Screen } from '../../components/Screen';
import { localizeProposalField, localizeStatus, useLocale } from '../../locale';

import type { FC } from 'react';

import type { Finding, ProposedChange } from '@antica/contracts';

export type AnalysisContainerProps = { runId: string };
type ReferenceKind = 'evidence' | 'observation' | 'citation';

export const AnalysisContainer: FC<AnalysisContainerProps> = ({ runId }) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [actionText, setActionText] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const checkRequestKeys = useRef(new Map<string, string>());
  const run = useQuery({
    queryKey: ['analysis', runId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/analyses/${runId}`, analysisRunDetailSchema, signal),
    refetchInterval: (query) =>
      ['queued', 'running'].includes(query.state.data?.status ?? '')
        ? 3000
        : false,
  });
  const record = useQuery({
    queryKey: ['record', run.data?.recordId],
    enabled: Boolean(run.data?.recordId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/records/${run.data?.recordId}`, recordDetailSchema, signal),
  });
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

  const apply = async (): Promise<void> => {
    if (!record.data || selected.length === 0 || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = applyAnalysisChangesSchema.parse({
        expectedRecordRevision: record.data.recordRevision,
        selectedProposalIds: selected,
      });
      await api.post(`/v1/analyses/${runId}/apply`, recordDetailSchema, {
        body: request,
        idempotencyKey: randomUUID(),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['record', record.data.id] }),
        queryClient.invalidateQueries({ queryKey: ['analysis', runId] }),
      ]);
      setSelected([]);
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

  const resolveAction = async (
    actionId: string,
    revision: number,
    status: 'supplied' | 'dismissed',
  ): Promise<void> => {
    if (!record.data || busy) {
      return;
    }
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
              expectedRecordRevision: record.data.recordRevision,
              support: { onSiteDescription: note },
            }
          : {
              status,
              expectedActionRevision: revision,
              expectedRecordRevision: record.data.recordRevision,
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

  return (
    <Screen
      title={t('results')}
      subtitle={
        run.data
          ? `${localizeStatus(run.data.status, t)} · ${t('version')} ${run.data.snapshot.analysisInputVersion}`
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
                <>
                  <Text accessibilityRole="alert" style={styles.error}>
                    {t('analysisFailed')}
                  </Text>
                  <ActionButton
                    label={t('reviewItem')}
                    onPress={() =>
                      router.push(`/collection/${run.data.recordId}`)
                    }
                    secondary
                  />
                </>
              )}
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

                    return (
                      <View key={action.id} style={styles.card}>
                        <Text style={styles.body}>{action.instruction}</Text>
                        <Text style={styles.secondary}>{action.reason}</Text>
                        <Text style={styles.secondary}>
                          {localizeStatus(state?.status ?? 'pending', t)}
                        </Text>
                        {action.checkId && (
                          <ActionButton
                            label={t('checks')}
                            onPress={() =>
                              router.push(`/checks/${action.checkId}`)
                            }
                            secondary
                          />
                        )}
                        {state?.status === 'pending' && (
                          <>
                            <TextField
                              label={t('reason')}
                              value={actionText[action.id] ?? ''}
                              onChangeText={(value) =>
                                setActionText((current) => ({
                                  ...current,
                                  [action.id]: value,
                                }))
                              }
                              multiline
                            />
                            <ActionButton
                              label={t('supplied')}
                              onPress={() =>
                                void resolveAction(
                                  action.id,
                                  state.revision,
                                  'supplied',
                                )
                              }
                              disabled={busy || !record.data}
                              secondary
                            />
                            <ActionButton
                              label={t('dismiss')}
                              onPress={() =>
                                void resolveAction(
                                  action.id,
                                  state.revision,
                                  'dismissed',
                                )
                              }
                              disabled={busy || !record.data}
                              secondary
                            />
                          </>
                        )}
                      </View>
                    );
                  })}
                </View>
                <View style={styles.card}>
                  <Text style={styles.heading}>{t('proposal')}</Text>
                  {output.proposedChanges.map((change) => (
                    <ProposalRow
                      key={change.id}
                      change={change}
                      status={
                        run.data.result.proposalStates.find(
                          (item) => item.proposalId === change.id,
                        )?.status ?? 'pending'
                      }
                      evidence={output.findings
                        .filter((finding) =>
                          change.findingIds.includes(finding.id),
                        )
                        .map((finding) => finding.text)}
                      checked={selected.includes(change.id)}
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
                    label={`${t('applySelected')} (${selected.length})`}
                    onPress={() => void apply()}
                    disabled={
                      busy ||
                      selected.length === 0 ||
                      record.data?.analysisInputVersion !==
                        run.data.snapshot.analysisInputVersion
                    }
                  />
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
              label={`${t(kind)} ${id.slice(0, 8)}`}
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
  status: 'pending' | 'accepted' | 'skipped';
  evidence: string[];
  checked: boolean;
  onToggle: () => void;
};
const ProposalRow: FC<ProposalRowProps> = ({
  change,
  status,
  evidence,
  checked,
  onToggle,
}) => {
  const { t } = useLocale();

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: status !== 'pending' }}
      disabled={status !== 'pending'}
      onPress={onToggle}
      style={styles.card}>
      <Text style={styles.heading}>
        {checked ? '☑' : '☐'} {localizeProposalField(change.field, t)} ·{' '}
        {localizeStatus(status, t)}
      </Text>
      <Text style={styles.body}>
        {t('previous')}: {JSON.stringify(change.before)}
      </Text>
      <Text style={styles.body}>
        {t('proposed')}: {JSON.stringify(change.proposed)}
      </Text>
      {evidence.map((value, index) => (
        <Text key={index} style={styles.secondary}>
          {value}
        </Text>
      ))}
    </Pressable>
  );
};
