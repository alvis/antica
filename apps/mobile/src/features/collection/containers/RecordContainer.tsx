import { useQuery } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Linking,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  cursorPageSchema,
  evidenceCreationSchema,
  observationSchema,
  referencePageSchema,
} from '@antica/contracts';
import {
  ActionButton,
  SegmentControl,
  ThumbnailStrip,
  colors,
  styles,
  theme,
} from '@antica/ui';

import { IconButton } from '../../../components/IconButton';
import { QueryState } from '../../../components/QueryState';
import { AskPill, Screen } from '../../../components/Screen';
import { SectionHeader } from '../../../components/SectionHeader';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { useStartAnalysis } from '../../analysis/hooks/useStartAnalysis';
import { RecordUploadsContainer } from '../../capture/containers/RecordUploadsContainer';
import { useUnfinishedUploads } from '../../capture/hooks/useUnfinishedUploads';

import { RelatedKnowledgeContainer } from '../../knowledge/containers/RelatedKnowledgeContainer';

import { RecordDataRows } from '../components/RecordDataRows';
import { RecordEditNotice } from '../components/RecordEditNotice';
import { RecordFactTiles } from '../components/RecordFactTiles';
import { RecordHero, heroHeight } from '../components/RecordHero';
import { RecordPrimaryAction } from '../components/RecordPrimaryAction';
import { useRecordHub } from '../hooks/useRecordHub';
import {
  angleLabel,
  carouselMedia,
  fieldBadges,
  recordPrimary,
} from '../record-hub';
import {
  collectionRows,
  otherFieldRows,
  primaryStatus,
  recordFacts,
  recordMeta,
} from '../record-hub-display';

import type { FC } from 'react';

import type { MediaDetail, RecordDetail } from '@antica/contracts';

import type { HeroPhoto } from '../components/RecordHero';
import type { RecordHub } from '../hooks/useRecordHub';
import type { FieldBadge } from '../record-hub';

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

/** the hub's in-place segments; 建議, 對話 and 紀錄 open their own screens */
type Segment = 'data' | 'checks';

/** how many thumbnails show before the strip counts the rest */
const thumbnailLimit = 4;

const layout = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.color.bg.page },
  content: { paddingBottom: theme.space[32] },
  inset: { paddingHorizontal: theme.space.page },
  thumbs: { paddingTop: theme.space[10] },
  heading: { paddingTop: 14, paddingHorizontal: theme.space.page },
  title: { ...theme.type.title, color: theme.color.text.primary },
  meta: {
    marginTop: theme.space[2],
    ...theme.type.small,
    color: theme.color.text.tertiary,
  },
  primary: { paddingTop: 14, paddingHorizontal: theme.space.page },
  segments: { marginTop: theme.space[16], paddingHorizontal: theme.space.page },
  section: {
    paddingTop: theme.space.section,
    gap: theme.space[12],
  },
  sectionInset: {
    paddingTop: theme.space.section,
    paddingHorizontal: theme.space.page,
    gap: theme.space[12],
  },
  notice: { ...theme.type.body2, color: theme.color.text.secondary },
  statusBacking: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.color.bg.page,
  },
  toggle: {
    minHeight: theme.size.hitMin,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  toggleText: {
    ...theme.type.body2,
    ...theme.font.face('sans', '600'),
    color: theme.color.accent.default,
  },
});

export const RecordContainer: FC<RecordContainerProps> = ({ recordId }) => {
  const router = useRouter();
  const { t } = useLocale();
  const hub = useRecordHub(recordId);
  const record = hub.record.data;

  if (!record) {
    return (
      <Screen title={t('collection')}>
        <QueryState
          loading={hub.record.isPending}
          error={hub.record.error}
          retry={() => void hub.record.refetch()}>
          {null}
        </QueryState>
      </Screen>
    );
  }

  return <RecordHubScreen hub={hub} record={record} router={router} />;
};

/**
 * the record hub (v5 record): photos edge to edge, the title, one adaptive first action, the
 * segments, and the record's facts, related knowledge and collection details
 * @param props hub properties
 * @param props.hub the hub's reads
 * @param props.record the loaded record
 * @param props.router navigation
 * @returns the screen
 */
const RecordHubScreen: FC<{
  hub: RecordHub;
  record: RecordDetail;
  router: ReturnType<typeof useRouter>;
}> = ({ hub, record, router }) => {
  const recordId = record.id;
  const { observationId, checkId } = useLocalSearchParams<{
    observationId?: string;
    checkId?: string;
  }>();
  const { api } = useAuth();
  const { t, locale } = useLocale();
  const { top } = useSafeAreaInsets();
  const scrollViewRef = useRef<ScrollView>(null);
  const observationsSectionLayout = useRef<number | null>(null);
  const observationLayouts = useRef(new Map<string, number>());
  const scrolledObservation = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [photoIndex, setPhotoIndex] = useState(0);
  const [segment, setSegment] = useState<Segment>('data');
  const [allFields, setAllFields] = useState(false);
  const [overHero, setOverHero] = useState(true);
  const [focused, setFocused] = useState(true);
  // the hub stays mounted under the screens it opens; only the focused hub sets the status bar
  useFocusEffect(
    useCallback(() => {
      setFocused(true);

      return () => setFocused(false);
    }, []),
  );
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
  // a file that failed on the server can be sent again while this device keeps its copy
  const retriable = useUnfinishedUploads().some(
    (group) => group.recordId === recordId,
  );
  const { labels } = hub.fieldLabels;
  const loadedMedia = hub.fieldLabels.media;
  const photos = carouselMedia(loadedMedia);
  // nothing shows while the record has no photo yet
  const shown = photos.at(Math.min(photoIndex, photos.length - 1));
  const verifiedCount = hub.fieldLabels.mediaQueries.filter((item) =>
    verifiedStates.has(item.data?.asset.state),
  ).length;
  const failed = loadedMedia.filter(
    (detail) => detail.asset.state === 'failed',
  );
  // a run that cannot be read can still be opened by its id
  const runId = hub.run.data?.runId ?? record.latestRunId ?? undefined;
  const primary = recordPrimary({
    analysisState: hub.analysisState,
    run: hub.run.data,
    editChanges: hub.editChanges,
    tasks: hub.tasks,
  });
  const badges = fieldBadges(hub.suggestions, hub.editChanges);
  const recordPath = `/collection/${encodeURIComponent(recordId)}`;
  const openEditor = (): void => router.push(`${recordPath}/edit`);
  const openMessages = (): void => router.push(`${recordPath}/messages`);
  const openRun = (): void => {
    if (runId) {
      router.push(`/analysis/${encodeURIComponent(runId)}`);
    }
  };
  const openCapture = (): void =>
    router.push(`/capture?recordId=${encodeURIComponent(recordId)}`);

  const scrollToReferencedObservation = useCallback((): void => {
    if (!observationId) {
      return;
    }
    const key = `${recordId}:${observationId}`;
    const sectionY = observationsSectionLayout.current;
    const observationY = observationLayouts.current.get(key);
    if (
      sectionY === null ||
      observationY === undefined ||
      scrolledObservation.current === key
    ) {
      return;
    }
    scrolledObservation.current = key;
    requestAnimationFrame(() => {
      scrollViewRef.current?.scrollTo({
        y: Math.max(0, sectionY + observationY - styles.content.gap),
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
          `/research/similar?anchorId=${encodeURIComponent(evidence.id)}&recordId=${encodeURIComponent(recordId)}&assetId=${encodeURIComponent(detail.asset.id)}&viewId=${encodeURIComponent(view.id)}`,
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
      router.push(
        `/media/${encodeURIComponent(reference.reference.originalAssetId)}`,
      );

      return;
    }
    const locator = reference.reference.locator;
    if (locator.kind === 'page') {
      router.push(
        `/sources/${encodeURIComponent(locator.sourceId)}?versionId=${encodeURIComponent(locator.sourceVersionId)}&pageId=${encodeURIComponent(locator.pageId)}`,
      );
    } else {
      void Linking.openURL(locator.url).catch((cause) =>
        setError((cause as Error).message),
      );
    }
  };

  const takePrimary = (): void => {
    switch (primary.kind) {
      case 'review':
      case 'done':
        openRun();
        break;
      case 'confirmEdits':
        openMessages();
        break;
      case 'capture':
        openCapture();
        break;
      case 'analyse':
        void analysis.start(record);
        break;
      case 'unknown':
        void hub.run.refetch();
        break;
      default:
        break;
    }
  };

  const heroPhotos: HeroPhoto[] = photos.map((detail, index) => ({
    id: detail.asset.id,
    uri: detail.asset.kind === 'photo' ? detail.reads[0]?.url : undefined,
    label: t('recordPhotoLabel', {
      name:
        angleLabel(detail.asset.originalFileName) ??
        detail.asset.originalFileName,
      index: index + 1,
      total: photos.length,
    }),
    testID: `record-media-${detail.asset.id}-${detail.asset.state}`,
  }));
  const angle = shown && angleLabel(shown.asset.originalFileName);
  const checkQuery = checkId ? `?checkId=${encodeURIComponent(checkId)}` : '';
  const position = { index: photoIndex + 1, total: photos.length };
  const countText = angle
    ? t('recordPhotoAngle', { ...position, angle })
    : t('recordPhotoIndex', position);
  const factBadgeTarget = (badge: FieldBadge | undefined): (() => void) =>
    badge === 'suggestion'
      ? openRun
      : badge === 'edit'
        ? openMessages
        : openEditor;
  const facts = recordFacts(record, labels, badges, t, locale).map((fact) => ({
    ...fact,
    onPress: factBadgeTarget(fact.badge),
  }));
  const moreFields = otherFieldRows(record, labels, t, locale);

  return (
    <View style={layout.screen}>
      {focused && (
        <StatusBar
          barStyle={overHero ? 'light-content' : 'dark-content'}
          translucent
          backgroundColor="transparent"
        />
      )}
      <ScrollView
        ref={scrollViewRef}
        testID="record-hub"
        keyboardShouldPersistTaps="handled"
        scrollEventThrottle={32}
        onScroll={(event) => {
          // past the photo the status bar sits on paper and needs dark icons
          setOverHero(event.nativeEvent.contentOffset.y < heroHeight - top);
        }}
        contentContainerStyle={layout.content}>
        <RecordHero
          photos={heroPhotos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onOpenPhoto={(id) =>
            router.push(`/media/${encodeURIComponent(id)}${checkQuery}`)
          }
          count={
            photos.length > 0
              ? {
                  text: countText,
                  // the spoken indicator also says how many files the server verified
                  accessibilityLabel: `${t('mediaCount', { count: verifiedCount })}${t('spokenSeparator')}${countText}`,
                }
              : undefined
          }
          start={
            <IconButton
              testID="record-back"
              icon="back"
              label={t('back')}
              onPhoto
              onPress={() => router.back()}
            />
          }
          end={
            <AskPill
              variant="onPhoto"
              context={{
                kind: 'record',
                recordId,
                name: record.name ?? undefined,
                code: record.code,
              }}
            />
          }
        />
        <View style={layout.thumbs}>
          <ThumbnailStrip
            testID="record-thumbnails"
            items={heroPhotos.map((photo) => ({
              id: photo.id,
              uri: photo.uri,
              label: photo.label,
              testID: `record-thumb-${photo.id}`,
            }))}
            selectedId={shown?.asset.id}
            limit={thumbnailLimit}
            onSelect={(id) =>
              setPhotoIndex(
                photos.findIndex((detail) => detail.asset.id === id),
              )
            }
            action={
              shown?.asset.kind === 'photo'
                ? {
                    label: t('recordFindSimilar'),
                    icon: 'imageSearch',
                    testID: 'record-find-similar',
                    onPress: () => void searchImage(shown),
                  }
                : undefined
            }
          />
        </View>
        <View style={layout.heading}>
          <Text accessibilityRole="header" style={layout.title}>
            {record.name ?? record.code}
          </Text>
          <Text style={layout.meta}>
            {recordMeta(record, labels, t, locale)}
          </Text>
        </View>
        <View style={layout.primary}>
          <RecordPrimaryAction
            primary={primary}
            analysisState={hub.analysisState}
            status={primaryStatus(primary, hub, t, locale)}
            canAnalyse={record.mediaIds.length > 0}
            busy={
              analysis.starting ||
              (primary.kind === 'unknown' && hub.run.isFetching)
            }
            error={analysis.error || undefined}
            onPress={takePrimary}
          />
        </View>
        <View style={layout.segments}>
          <SegmentControl<Segment | 'suggestions' | 'chat' | 'history'>
            testID="record-segments"
            accessibilityLabel={t('recordSegmentsLabel')}
            value={segment}
            onChange={(value) => {
              if (value === 'suggestions') {
                openRun();
              } else if (value === 'chat') {
                openMessages();
              } else if (value === 'history') {
                router.push(`${recordPath}/history`);
              } else {
                setSegment(value);
              }
            }}
            options={[
              {
                value: 'data',
                label: t('recordSegData'),
                testID: 'record-segment-data',
              },
              {
                value: 'checks',
                label: t('recordSegChecks'),
                // no count until 查驗 has its own screen (UIO09), so the badge never disagrees with it
                testID: 'record-segment-checks',
              },
              {
                value: 'suggestions',
                label: t('recordSegSuggestions'),
                badge: hub.suggestions.length || undefined,
                disabled: !runId,
                navigates: true,
                testID: 'record-open-run-segment',
              },
              {
                value: 'chat',
                label: t('recordSegChat'),
                navigates: true,
                testID: 'record-messages-entry',
              },
              {
                value: 'history',
                label: t('recordSegHistory'),
                navigates: true,
                testID: 'record-open-history',
              },
            ]}
          />
        </View>
        {segment === 'checks' ? (
          <View style={layout.sectionInset}>
            <Text style={layout.notice}>{t('recordChecksSoon')}</Text>
            {/* the design captures under 查驗, so 補充證據 lives here until it has its own screen */}
            <ActionButton
              testID="record-add-evidence"
              label={t('addEvidence')}
              icon="camera"
              onPress={openCapture}
              secondary
            />
            {record.checkIds.map((id) => (
              <ActionButton
                key={id}
                label={t('checkWithId', { id: id.slice(0, 8) })}
                onPress={() => router.push(`/checks/${encodeURIComponent(id)}`)}
                secondary
              />
            ))}
          </View>
        ) : (
          <>
            <View testID="record-fields" style={layout.sectionInset}>
              <SectionHeader
                title={t('recordData')}
                links={[
                  {
                    label: t('edit'),
                    icon: 'edit',
                    onPress: openEditor,
                    testID: 'record-edit',
                  },
                ]}
              />
              <RecordEditNotice recordId={recordId} />
              <RecordUploadsContainer recordId={recordId} />
              {failed.map((detail) => (
                <View key={detail.asset.id} style={{ gap: theme.space[8] }}>
                  <Text style={layout.notice}>
                    {detail.asset.originalFileName} · {t('uploadNotUploaded')}
                  </Text>
                  {retriable && (
                    <ActionButton
                      testID={`record-media-${detail.asset.id}-retry`}
                      label={t('retryUpload')}
                      onPress={() =>
                        router.push(
                          `/capture?recordId=${encodeURIComponent(recordId)}&resume=1`,
                        )
                      }
                    />
                  )}
                </View>
              ))}
              <RecordFactTiles facts={facts} />
            </View>
            <View style={layout.section}>
              <RelatedKnowledgeContainer
                recordId={recordId}
                recordRevision={record.recordRevision}
              />
            </View>
            <View style={layout.sectionInset}>
              <SectionHeader title={t('recordCollectionData')} />
              <RecordDataRows
                testID="record-collection-data"
                rows={[
                  ...collectionRows(record, labels, t, locale, openEditor),
                  ...(allFields ? moreFields : []),
                ]}
              />
              {moreFields.length > 0 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: allFields }}
                  testID="record-fields-toggle"
                  onPress={() => setAllFields((current) => !current)}
                  style={layout.toggle}>
                  <Text style={layout.toggleText}>
                    {allFields ? t('showFewerDetails') : t('showAllDetails')}
                  </Text>
                </Pressable>
              )}
            </View>
            {observations.data && observations.data.items.length > 0 && (
              <View
                style={layout.sectionInset}
                onLayout={(event) => {
                  observationsSectionLayout.current =
                    event.nativeEvent.layout.y;
                  scrollToReferencedObservation();
                }}>
                <SectionHeader title={t('collectorObservations')} />
                {observations.data.items.map((item) => {
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
                              { borderColor: colors.jade, borderWidth: 2 },
                            ]
                          : styles.card
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
              </View>
            )}
            {references.data && references.data.items.length > 0 && (
              <View style={layout.sectionInset}>
                <SectionHeader title={t('references')} />
                {references.data.items.map((item) => (
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
              </View>
            )}
          </>
        )}
        {Boolean(error) && (
          <Text
            accessibilityRole="alert"
            style={[
              styles.error,
              layout.inset,
              { marginTop: theme.space[12] },
            ]}>
            {error}
          </Text>
        )}
      </ScrollView>
      {!overHero && <View style={[layout.statusBacking, { height: top }]} />}
    </View>
  );
};
