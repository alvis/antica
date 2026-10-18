import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useLocalSearchParams, useRouter } from 'expo-router';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Image, Linking, Text, View } from 'react-native';

import {
  analysisAcceptedSchema,
  cursorPageSchema,
  evidenceCreationSchema,
  mediaDetailSchema,
  observationSchema,
  recordDetailSchema,
  recordPatchSchema,
  referencePageSchema,
  requestAnalysisSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';

import { recordQuery } from '../api/record-query';
import { RecordMessagesEntryContainer } from '../messages/containers/RecordMessagesEntryContainer';

import type { FC } from 'react';

import type { ScrollView } from 'react-native';

import type { MediaDetail } from '@antica/contracts';

export type RecordContainerProps = { recordId: string };

export const RecordContainer: FC<RecordContainerProps> = ({ recordId }) => {
  const router = useRouter();
  const { observationId, checkId } = useLocalSearchParams<{
    observationId?: string;
    checkId?: string;
  }>();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const scrollViewRef = useRef<ScrollView>(null);
  const observationsSectionLayout = useRef<{
    recordId: string;
    y: number;
  } | null>(null);
  const observationLayouts = useRef(new Map<string, number>());
  const scrolledObservation = useRef<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const record = useQuery(recordQuery(api, recordId));
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
  const media = useQueries({
    queries: (record.data?.mediaIds ?? []).map((id) => ({
      queryKey: ['media', id],
      queryFn: async ({ signal }: { signal: AbortSignal }) =>
        api.get(`/v1/media/${id}`, mediaDetailSchema, signal),
    })),
  });

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

  const analyze = async (): Promise<void> => {
    if (!record.data || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = requestAnalysisSchema.parse({
        expectedRecordRevision: record.data.recordRevision,
      });
      const accepted = await api.post(
        `/v1/records/${recordId}/analyses`,
        analysisAcceptedSchema,
        { body: request, idempotencyKey: randomUUID() },
      );
      router.push(`/analysis/${accepted.runId}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (): Promise<void> => {
    if (!record.data || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = recordPatchSchema.parse({
        expectedRevision: record.data.recordRevision,
        fields: { name: name.trim() || null, description },
      });
      await api.patch(`/v1/records/${recordId}`, recordDetailSchema, {
        body: request,
        idempotencyKey: randomUUID(),
      });
      await queryClient.invalidateQueries({ queryKey: ['record', recordId] });
      await queryClient.invalidateQueries({ queryKey: ['records'] });
      setEditing(false);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
              <Text style={styles.body}>
                {record.data.analysisFreshness === 'outdated'
                  ? t('newEvidence')
                  : record.data.analysisFreshness === 'unanalyzed'
                    ? t('notAnalyzed')
                    : t('saved')}
              </Text>
              <Text style={styles.secondary}>
                {t('locationValue', {
                  location: record.data.location.detail || t('unknown'),
                })}
              </Text>
              <Text style={styles.body}>
                {record.data.description || t('empty')}
              </Text>
              <ActionButton
                label={
                  record.data.latestRunId ? t('analyzeAgain') : t('analyze')
                }
                onPress={() => void analyze()}
                disabled={busy || record.data.mediaIds.length === 0}
              />
              {record.data.latestRunId && (
                <ActionButton
                  label={t('results')}
                  onPress={() =>
                    router.push(`/analysis/${record.data.latestRunId}`)
                  }
                  secondary
                />
              )}
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
            </View>
            <RecordMessagesEntryContainer recordId={recordId} />
            <View style={styles.card}>
              <Text style={styles.heading}>
                {t('photo')} / {t('video')}
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
                        ? localizeStatus(detail.asset.state, t)
                        : t('loading')}
                    </Text>
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
            <View style={styles.card}>
              <Text style={styles.heading}>{t('description')}</Text>
              {editing ? (
                <>
                  <TextField
                    label={t('name')}
                    value={name}
                    onChangeText={setName}
                  />
                  <TextField
                    label={t('description')}
                    value={description}
                    onChangeText={setDescription}
                    multiline
                  />
                  <ActionButton
                    label={t('save')}
                    onPress={() => void saveEdit()}
                    disabled={busy}
                  />
                </>
              ) : (
                <ActionButton
                  label={t('edit')}
                  onPress={() => {
                    setName(record.data.name ?? '');
                    setDescription(record.data.description);
                    setEditing(true);
                  }}
                  secondary
                />
              )}
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
