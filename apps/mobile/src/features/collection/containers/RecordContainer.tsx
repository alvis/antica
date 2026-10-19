import { useQuery } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Image, Linking, Text, View } from 'react-native';

import {
  cursorPageSchema,
  evidenceCreationSchema,
  observationSchema,
  referencePageSchema,
} from '@antica/contracts';
import { ActionButton, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { analysisRunQuery } from '../../analysis/api/analysis-run-query';
import { useStartAnalysis } from '../../analysis/hooks/useStartAnalysis';
import { RecordUploadsContainer } from '../../capture/containers/RecordUploadsContainer';
import { useUnfinishedUploads } from '../../capture/hooks/useUnfinishedUploads';

import { RelatedKnowledgeContainer } from '../../knowledge/containers/RelatedKnowledgeContainer';

import { recordQuery } from '../api/record-query';
import { RecordAnalysisStatus } from '../components/RecordAnalysisStatus';
import { RecordEditNotice } from '../components/RecordEditNotice';
import { RecordFieldSummary } from '../components/RecordFieldSummary';
import { useRecordFieldLabels } from '../hooks/useRecordFieldLabels';
import { RecordMessagesEntryContainer } from '../messages/containers/RecordMessagesEntryContainer';
import { recordAnalysisState } from '../record-analysis-state';

import type { FC } from 'react';

import type { ScrollView } from 'react-native';

import type { MediaDetail } from '@antica/contracts';

export type RecordContainerProps = { recordId: string };

/**
 * asset states whose bytes the server verified, the only ones counted as uploaded; completion
 * checks the digest before it marks an asset uploaded, ahead of processing
 */
const verifiedStates: ReadonlySet<unknown> = new Set([
  'uploaded',
  'processing',
  'ready',
]);

export const RecordContainer: FC<RecordContainerProps> = ({ recordId }) => {
  const router = useRouter();
  const { observationId, checkId } = useLocalSearchParams<{
    observationId?: string;
    checkId?: string;
  }>();
  const { api } = useAuth();
  const { t } = useLocale();
  const scrollViewRef = useRef<ScrollView>(null);
  const observationsSectionLayout = useRef<{
    recordId: string;
    y: number;
  } | null>(null);
  const observationLayouts = useRef(new Map<string, number>());
  const scrolledObservation = useRef<string | null>(null);
  const [error, setError] = useState('');
  const record = useQuery(recordQuery(api, recordId));
  const fieldLabels = useRecordFieldLabels({
    knowledgeIds: [
      ...(record.data?.categoryIds ?? []),
      ...(record.data?.materialIds ?? []),
    ],
    mediaIds: record.data?.mediaIds ?? [],
  });
  const latestRunId = record.data?.latestRunId;
  const latestRun = useQuery({
    ...analysisRunQuery(api, latestRunId ?? ''),
    enabled: Boolean(latestRunId),
  });
  const analysis = useStartAnalysis(api, t);
  const observations = useQuery({
    queryKey: ['observations', recordId],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/records/${recordId}/observations`,
        cursorPageSchema(observationSchema),
        signal,
      ),
  });
  const references = useQuery({
    queryKey: ['references', recordId],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/records/${recordId}/references`,
        referencePageSchema,
        signal,
      ),
  });
  // the labels hook reads the record's media once for both uses
  const media = fieldLabels.mediaQueries;
  // a file that failed on the server can be sent again while this device keeps its copy
  const retriable = useUnfinishedUploads().some(
    (group) => group.recordId === recordId,
  );

  const scrollToReferencedObservation = useCallback((): void => {
    if (!observationId) {
      return;
    }
    const key = `${recordId}:${observationId}`;
    const section = observationsSectionLayout.current;
    const observationY = observationLayouts.current.get(key);
    if (
      section?.recordId !== recordId ||
      observationY === undefined ||
      scrolledObservation.current === key
    ) {
      return;
    }
    scrolledObservation.current = key;
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, section.y + observationY - styles.content.gap),
        animated: false,
      });
    });
  }, [observationId, recordId]);

  useEffect(() => {
    scrollToReferencedObservation();
  }, [scrollToReferencedObservation]);

  const searchImage = async (detail: MediaDetail): Promise<void> => {
    const view = detail.asset.views[0];
    setError('');
    try {
      const requestKey = randomUUID();
      const evidence = await api.post('/v1/evidence', evidenceCreationSchema, {
        body: {
          requestKey,
          mode: 'create',
          evidence: {
            kind: 'image',
            recordId,
            componentIds: detail.asset.componentIds,
            originalAssetId: detail.asset.id,
            canonicalViewId: view.id,
            scope: { kind: 'whole' },
          },
        },
        idempotencyKey: requestKey,
      });
      if ('kind' in evidence && evidence.kind === 'image') {
        router.push(
          `/research/similar?anchorId=${evidence.id}&recordId=${recordId}&assetId=${detail.asset.id}&viewId=${view.id}`,
        );
      } else {
        setError(t('processing'));
      }
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const openReference = (
    reference: NonNullable<typeof references.data>['items'][number],
  ): void => {
    if (reference.reference.kind === 'collection') {
      router.push(`/media/${reference.reference.originalAssetId}`);

      return;
    }
    const locator = reference.reference.locator;
    if (locator.kind === 'page') {
      router.push(
        `/sources/${locator.sourceId}?versionId=${locator.sourceVersionId}&pageId=${locator.pageId}`,
      );
    } else {
      void Linking.openURL(locator.url).catch((cause) =>
        setError((cause as Error).message),
      );
    }
  };

  return (
    <Screen
      title={record.data?.name ?? record.data?.code ?? t('collection')}
      subtitle={record.data?.code}
      scrollRef={scrollViewRef}>
      <QueryState
        loading={record.isPending}
        error={record.error}
        retry={() => void record.refetch()}>
        {record.data && (
          <>
            <View style={styles.card}>
              <RecordEditNotice recordId={recordId} />
              <RecordAnalysisStatus
                state={recordAnalysisState(
                  record.data,
                  latestRun.data?.status,
                  latestRun.isError,
                )}
                canAnalyse={record.data.mediaIds.length > 0}
                starting={analysis.starting}
                onAnalyse={() => void analysis.start(record.data)}
                onRetryRun={() => void latestRun.refetch()}
                retryingRun={latestRun.isFetching}
                error={analysis.error}
                onOpenRun={
                  record.data.latestRunId
                    ? () => router.push(`/analysis/${record.data.latestRunId}`)
                    : undefined
                }
              />
              <ActionButton
                label={t('addEvidence')}
                onPress={() => router.push(`/capture?recordId=${recordId}`)}
                secondary
              />
              <ActionButton
                secondary
                testID="record-open-history"
                label={t('viewChangeHistory')}
                onPress={() => router.push(`/collection/${recordId}/history`)}
              />
              <ActionButton
                secondary
                testID="record-edit"
                label={t('editDetails')}
                onPress={() =>
                  router.push(
                    `/collection/${encodeURIComponent(recordId)}/edit`,
                  )
                }
              />
            </View>
            <RecordMessagesEntryContainer recordId={recordId} />
            <RecordFieldSummary
              record={record.data}
              labels={fieldLabels.labels}
            />
            <RelatedKnowledgeContainer
              recordId={recordId}
              recordRevision={record.data.recordRevision}
            />
            <RecordUploadsContainer recordId={recordId} />
            <View style={styles.card}>
              <Text style={styles.heading}>
                {t('photo')} / {t('video')}
              </Text>
              <Text testID="record-media-count" style={styles.secondary}>
                {t('mediaCount', {
                  // a file awaiting its upload, or one that failed, is never counted as saved
                  count: media.filter((item) =>
                    verifiedStates.has(item.data?.asset.state),
                  ).length,
                })}
              </Text>
              {media.map((item, index) => {
                const detail = item.data;
                const query = checkId ? `?checkId=${checkId}` : '';

                return (
                  <View key={record.data.mediaIds[index]} style={styles.card}>
                    {detail?.asset.kind === 'photo' && detail.reads[0] && (
                      <Image
                        source={{ uri: detail.reads[0].url }}
                        style={{ width: '100%', height: 260 }}
                        resizeMode="contain"
                        accessibilityLabel={detail.asset.originalFileName}
                      />
                    )}
                    <Text
                      testID={`record-media-${record.data.mediaIds[index]}-${detail ? detail.asset.state : 'loading'}`}
                      style={styles.secondary}>
                      {detail?.asset.originalFileName ?? t('loading')} ·{' '}
                      {detail
                        ? detail.asset.state === 'failed'
                          ? t('uploadNotUploaded')
                          : localizeStatus(detail.asset.state, t)
                        : t('loading')}
                    </Text>
                    {detail?.asset.state === 'failed' && retriable && (
                      <ActionButton
                        testID={`record-media-${detail.asset.id}-retry`}
                        label={t('retryUpload')}
                        onPress={() =>
                          router.push(`/capture?recordId=${recordId}&resume=1`)
                        }
                      />
                    )}
                    {detail && (
                      <ActionButton
                        label={t('view')}
                        onPress={() =>
                          router.push(`/media/${detail.asset.id}${query}`)
                        }
                        secondary
                      />
                    )}
                    {detail?.asset.kind === 'photo' && (
                      <ActionButton
                        label={t('imageSearch')}
                        onPress={() => void searchImage(detail)}
                        secondary
                      />
                    )}
                  </View>
                );
              })}
            </View>
            <View
              style={styles.card}
              onLayout={(event) => {
                observationsSectionLayout.current = {
                  recordId,
                  y: event.nativeEvent.layout.y,
                };
                scrollToReferencedObservation();
              }}>
              <Text style={styles.heading}>{t('collectorObservations')}</Text>
              {observations.data?.items.map((item) => {
                const referenced = item.id === observationId;

                return (
                  <View
                    key={item.id}
                    accessible={referenced}
                    accessibilityRole={referenced ? 'text' : undefined}
                    accessibilityLabel={
                      referenced
                        ? t('referencedObservationText', { text: item.text })
                        : undefined
                    }
                    accessibilityState={
                      referenced ? { selected: true } : undefined
                    }
                    onLayout={
                      referenced
                        ? (event) => {
                            observationLayouts.current.set(
                              `${recordId}:${item.id}`,
                              event.nativeEvent.layout.y,
                            );
                            scrollToReferencedObservation();
                          }
                        : undefined
                    }
                    style={
                      referenced
                        ? [
                            styles.card,
                            { borderColor: '#173D35', borderWidth: 2 },
                          ]
                        : undefined
                    }>
                    {referenced && (
                      <Text style={styles.label}>
                        {t('referencedObservation')}
                      </Text>
                    )}
                    <Text style={styles.body}>{item.text}</Text>
                  </View>
                );
              })}
              {observations.data?.items.length === 0 && (
                <Text style={styles.secondary}>{t('empty')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('checks')}</Text>
              {record.data.checkIds.map((id) => (
                <ActionButton
                  key={id}
                  label={t('checkWithId', { id: id.slice(0, 8) })}
                  onPress={() => router.push(`/checks/${id}`)}
                  secondary
                />
              ))}
              {record.data.checkIds.length === 0 && (
                <Text style={styles.secondary}>{t('empty')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('references')}</Text>
              {references.data?.items.map((item) => (
                <View key={item.id} style={styles.card}>
                  <Text style={styles.body}>
                    {item.noteZhHant || item.reference.kind}
                  </Text>
                  <ActionButton
                    label={t('viewSource')}
                    onPress={() => openReference(item)}
                    secondary
                  />
                </View>
              ))}
              {references.data?.items.length === 0 && (
                <Text style={styles.secondary}>{t('empty')}</Text>
              )}
            </View>
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
