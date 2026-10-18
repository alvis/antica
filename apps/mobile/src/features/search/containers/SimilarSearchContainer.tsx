import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import {
  Image,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import {
  evidenceCreationSchema,
  imageComparisonSchema,
  imageSearchRequestSchema,
  imageSearchResultSchema,
  mediaDetailSchema,
  recordDetailSchema,
  referenceInputSchema,
  referenceLinkSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

import type {
  ImageComparison,
  ImageMatch,
  ImageSearchResult,
} from '@antica/contracts';

interface ComparisonSelection {
  queryAnchorId: string;
  scope: 'reference_library' | 'my_collection';
  match: ImageMatch;
  response: ImageComparison;
}

export type SimilarSearchContainerProps = {
  anchorId?: string;
  recordId?: string;
  assetId?: string;
  viewId?: string;
};

export const SimilarSearchContainer: FC<SimilarSearchContainerProps> = ({
  anchorId,
  recordId,
  assetId,
  viewId,
}) => {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<'reference_library' | 'my_collection'>(
    'reference_library',
  );
  const [currentAnchorId, setCurrentAnchorId] = useState(anchorId ?? '');
  const [whole, setWhole] = useState(true);
  const [result, setResult] = useState<ImageSearchResult | null>(null);
  const [comparison, setComparison] = useState<ComparisonSelection | null>(
    null,
  );
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const media = useQuery({
    queryKey: ['media', assetId],
    enabled: Boolean(assetId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/media/${assetId}`, mediaDetailSchema, signal),
  });
  const record = useQuery({
    queryKey: ['record', recordId],
    enabled: Boolean(recordId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/records/${recordId}`, recordDetailSchema, signal),
  });
  const view =
    media.data?.asset.views.find((item) => item.id === viewId) ??
    media.data?.asset.views[0];
  const imageWidth = width - 32;
  const imageHeight = view ? (imageWidth * view.height) / view.width : 300;
  const imageUrl =
    media.data?.reads.find(
      (read) => read.assetOrDerivativeId === view?.derivativeId,
    )?.url ?? media.data?.reads[0]?.url;
  const activeComparison =
    comparison?.queryAnchorId === currentAnchorId && comparison.scope === scope
      ? comparison
      : null;

  const selectRegion = async (x: number, y: number): Promise<void> => {
    if (!recordId || !assetId || !view || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const region = {
        kind: 'rect' as const,
        x: Math.min(Math.max(x / imageWidth - 0.125, 0), 0.75),
        y: Math.min(Math.max(y / imageHeight - 0.125, 0), 0.75),
        width: 0.25,
        height: 0.25,
      };
      const evidence = await api.post('/v1/evidence', evidenceCreationSchema, {
        body: {
          requestKey: randomUUID(),
          mode: 'create',
          evidence: {
            kind: 'image',
            recordId,
            componentIds: media.data?.asset.componentIds ?? [],
            originalAssetId: assetId,
            canonicalViewId: view.id,
            scope: { kind: 'region', region, cropDerivativeId: null },
          },
        },
        idempotencyKey: randomUUID(),
      });
      if ('kind' in evidence && evidence.kind === 'image') {
        setCurrentAnchorId(evidence.id);
        setWhole(false);
        setResult(null);
        setComparison(null);
      } else {
        setError(t('processing'));
      }
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const search = async (): Promise<void> => {
    if (!currentAnchorId || busy) {
      return;
    }
    setBusy(true);
    setError('');
    setComparison(null);
    try {
      const request = imageSearchRequestSchema.parse({
        mode: 'search',
        queryAnchorId: currentAnchorId,
        includeWholeImage: whole,
        scope,
        filters: {},
        limit: 30,
      });
      setResult(
        await api.post('/v1/search/images', imageSearchResultSchema, {
          body: request,
        }),
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const compare = async (match: ImageMatch): Promise<void> => {
    if (busy) {
      return;
    }
    const queryAnchorId = currentAnchorId;
    setBusy(true);
    setError('');
    setComparison(null);
    try {
      const data = await api.post('/v1/search/images', imageComparisonSchema, {
        body: {
          mode: 'compare',
          queryAnchorId,
          selected: match.ref,
          selectedRegion: match.matchingRegions[0]?.region ?? null,
          selectedCanonicalViewId:
            match.matchingRegions[0]?.canonicalViewId ?? null,
        },
      });
      setComparison({ queryAnchorId, scope, match, response: data });
    } catch (cause) {
      setComparison(null);
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveReference = async (): Promise<void> => {
    if (!record.data || !activeComparison || busy) {
      return;
    }
    const { match } = activeComparison;
    if (match.ref.kind === 'reference' && !match.sourceLocator) {
      setError(t('sourceNeedsReview'));

      return;
    }
    setBusy(true);
    setError('');
    try {
      const reference =
        match.ref.kind === 'reference'
          ? {
              kind: 'source' as const,
              locator: match.sourceLocator!,
              referenceImageId: match.ref.referenceImageId,
            }
          : {
              kind: 'collection' as const,
              recordId: match.ref.recordId,
              originalAssetId: match.ref.originalAssetId,
              evidenceAnchorId: null,
            };
      const input = referenceInputSchema.parse({
        requestKey: randomUUID(),
        expectedRecordRevision: record.data.recordRevision,
        target: {
          recordId: record.data.id,
          checkId: null,
          observationId: null,
          evidenceAnchorId: currentAnchorId,
        },
        reference,
        comparisonId: activeComparison.response.comparisonId,
        noteZhHant: note,
      });
      await api.post('/v1/references', referenceLinkSchema, {
        body: input,
        idempotencyKey: input.requestKey,
      });
      await queryClient.invalidateQueries({
        queryKey: ['references', record.data.id],
      });
      setComparison(null);
      setNote('');
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('imageSearch')} subtitle={t('fullImage')}>
      {media.isPending && assetId && (
        <QueryState loading error={null} retry={() => void media.refetch()} />
      )}
      {imageUrl && (
        <View style={styles.card}>
          <Text style={styles.body}>{t('selectRegion')}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('selectRegion')}
            onPress={(event) =>
              void selectRegion(
                event.nativeEvent.locationX,
                event.nativeEvent.locationY,
              )
            }>
            <Image
              source={{ uri: imageUrl }}
              style={{ width: imageWidth, height: imageHeight }}
              resizeMode="stretch"
              accessibilityLabel={media.data?.asset.originalFileName}
            />
          </Pressable>
          <Text style={styles.secondary}>
            {whole ? t('fullImage') : t('selectRegion')}
          </Text>
          <ActionButton
            label={t('fullImage')}
            onPress={() => {
              setCurrentAnchorId(anchorId ?? '');
              setWhole(true);
              setResult(null);
              setComparison(null);
            }}
            secondary
          />
        </View>
      )}
      <View style={styles.card}>
        <Text style={styles.heading}>{t('scope')}</Text>
        <ActionButton
          label={t('references')}
          onPress={() => {
            setScope('reference_library');
            setResult(null);
            setComparison(null);
          }}
          secondary={scope !== 'reference_library'}
        />
        <ActionButton
          label={t('myCollection')}
          onPress={() => {
            setScope('my_collection');
            setResult(null);
            setComparison(null);
          }}
          secondary={scope !== 'my_collection'}
        />
        <ActionButton
          label={busy ? t('processing') : t('search')}
          onPress={() => void search()}
          disabled={busy || !currentAnchorId}
        />
      </View>
      {result?.availableScope === 'partial' && (
        <Text style={styles.secondary}>{t('partial')}</Text>
      )}
      {result?.warningsZhHant.map((warning, index) => (
        <Text key={index} style={styles.secondary}>
          {warning}
        </Text>
      ))}
      {result?.items.length === 0 && (
        <Text style={styles.body}>{t('empty')}</Text>
      )}
      {result?.items.map((match) => (
        <View
          key={
            match.ref.kind === 'reference'
              ? match.ref.referenceImageId
              : match.ref.originalAssetId
          }
          style={styles.card}>
          {match.thumbnail && (
            <Image
              source={{ uri: match.thumbnail.url }}
              style={{ width: '100%', height: 180 }}
              resizeMode="contain"
              accessibilityLabel={match.sourceTitle ?? t('photo')}
            />
          )}
          <Text style={styles.body}>
            {match.sourceTitle ?? t('myCollection')}
          </Text>
          <Text style={styles.secondary}>
            {t('rankValue', { rank: match.rank })} ·{' '}
            {match.contributorNames.join(', ') || t('unknownAuthor')}
          </Text>
          <ActionButton
            label={t('compare')}
            onPress={() => void compare(match)}
            secondary
          />
          {match.sourceLocator?.kind === 'page' && (
            <ActionButton
              label={t('viewSource')}
              onPress={() => {
                const locator = match.sourceLocator;
                if (locator?.kind === 'page') {
                  router.push(
                    `/sources/${locator.sourceId}?versionId=${locator.sourceVersionId}&pageId=${locator.pageId}`,
                  );
                }
              }}
              secondary
            />
          )}
        </View>
      ))}
      {activeComparison && (
        <View style={styles.card}>
          <Text style={styles.heading}>{t('compare')}</Text>
          <Text style={styles.body}>{t('similarity')}</Text>
          {activeComparison.response.similaritiesZhHant.map((value, index) => (
            <Text key={index} style={styles.body}>
              {value}
            </Text>
          ))}
          <Text style={styles.body}>{t('differences')}</Text>
          {activeComparison.response.differencesZhHant.map((value, index) => (
            <Text key={index} style={styles.body}>
              {value}
            </Text>
          ))}
          {activeComparison.response.limitsZhHant.map((value, index) => (
            <Text key={index} style={styles.secondary}>
              {value}
            </Text>
          ))}
          <TextField
            label={t('description')}
            value={note}
            onChangeText={setNote}
            multiline
          />
          <ActionButton
            label={t('addReference')}
            onPress={() => void saveReference()}
            disabled={!record.data || busy}
          />
        </View>
      )}
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
