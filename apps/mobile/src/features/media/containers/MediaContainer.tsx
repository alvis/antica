import { useQuery } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';
import { getItemAsync, setItemAsync } from 'expo-secure-store';
import { useEffect, useRef, useState } from 'react';

import { Image, Text, View } from 'react-native';

import {
  evidenceCreationSchema,
  frameJobResultSchema,
  jobEnvelopeSchema,
  mediaDetailSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

import type { PreparedFrameResult } from '@antica/contracts';

const frameJobSchema = jobEnvelopeSchema(frameJobResultSchema);

export type MediaContainerProps = {
  assetId: string;
  anchorId?: string;
  checkId?: string;
};

export const MediaContainer: FC<MediaContainerProps> = ({
  assetId,
  anchorId,
  checkId,
}) => {
  const { api } = useAuth();
  const { t } = useLocale();
  const [timeSeconds, setTimeSeconds] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [newAnchorId, setNewAnchorId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preparationKeys = useRef(new Map<number, string>());
  const anchorKeys = useRef(new Map<string, string>());
  const media = useQuery({
    queryKey: ['media', assetId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/media/${assetId}`, mediaDetailSchema, signal),
  });
  const frameJob = useQuery({
    queryKey: ['job', jobId],
    enabled: Boolean(jobId),
    queryFn: async ({ signal }) =>
      api.get(`/v1/jobs/${jobId}`, frameJobSchema, signal),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting'].includes(
        query.state.data?.state.kind ?? '',
      )
        ? 3000
        : false,
  });

  useEffect(() => {
    let active = true;
    void getItemAsync(`antica.frameJob.${assetId}`)
      .then((saved) => {
        if (active && saved) {
          setJobId((current) => current ?? saved);
        }
      })
      .catch((cause: unknown) => {
        setError((cause as Error).message);
      });

    return () => {
      active = false;
    };
  }, [assetId]);

  useEffect(() => {
    if (
      frameJob.data?.state.kind === 'succeeded' &&
      frameJob.data.result &&
      'frame' in frameJob.data.result
    ) {
      void media.refetch();
    }
  }, [frameJob.data?.state.kind, frameJob.data?.result, media.refetch]);

  const recordVideo =
    media.data?.asset.kind === 'video' &&
    media.data.asset.owner.kind === 'record'
      ? {
          recordId: media.data.asset.owner.recordId,
          durationMs: media.data.asset.durationMs,
          componentIds: media.data.asset.componentIds,
          state: media.data.asset.state,
        }
      : null;
  const frame =
    frameJob.data?.state.kind === 'succeeded' &&
    frameJob.data.result &&
    'frame' in frameJob.data.result
      ? frameJob.data.result
      : null;
  const frameRead = frame
    ? media.data?.reads.find(
        (item) => item.assetOrDerivativeId === frame.frame.frameDerivativeId,
      )
    : null;

  const prepareFrame = async (
    recordId: string,
    durationMs: number | null,
  ): Promise<void> => {
    const seconds = Number(timeSeconds);
    const requestedTimeMs = Math.round(seconds * 1000);
    if (
      !timeSeconds.trim() ||
      !Number.isFinite(seconds) ||
      seconds < 0 ||
      (durationMs !== null && requestedTimeMs > durationMs)
    ) {
      setError(t('frameTimeInvalid'));

      return;
    }
    setBusy(true);
    setError('');
    try {
      if (frameJob.data?.state.kind === 'failed') {
        preparationKeys.current.delete(requestedTimeMs);
      }
      const requestKey =
        preparationKeys.current.get(requestedTimeMs) ?? randomUUID();
      preparationKeys.current.set(requestedTimeMs, requestKey);
      const accepted = await api.post('/v1/evidence', evidenceCreationSchema, {
        body: {
          requestKey,
          mode: 'prepare_frame',
          recordId,
          originalAssetId: assetId,
          requestedTimeMs,
        },
        idempotencyKey: requestKey,
      });
      if (!('kind' in accepted) || accepted.kind !== 'media') {
        throw new Error(t('error'));
      }
      setJobId(accepted.id);
      void setItemAsync(`antica.frameJob.${assetId}`, accepted.id).catch(
        (cause: unknown) => {
          setError((cause as Error).message);
        },
      );
      setNewAnchorId(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const useFrame = async (
    recordId: string,
    componentIds: string[],
    prepared: PreparedFrameResult,
  ): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const requestKey =
        anchorKeys.current.get(prepared.frame.frameDerivativeId) ??
        randomUUID();
      anchorKeys.current.set(prepared.frame.frameDerivativeId, requestKey);
      const created = await api.post('/v1/evidence', evidenceCreationSchema, {
        body: {
          requestKey,
          mode: 'create',
          checkId,
          evidence: {
            kind: 'video_frame',
            recordId,
            componentIds,
            originalAssetId: assetId,
            canonicalViewId: prepared.view.id,
            scope: { kind: 'whole' },
            frame: prepared.frame,
          },
        },
        idempotencyKey: requestKey,
      });
      if (!('kind' in created) || created.kind !== 'video_frame') {
        throw new Error(t('error'));
      }
      setNewAnchorId(created.id);
      await media.refetch();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const anchor = media.data?.anchors.find(
    (item) => item.id === (newAnchorId ?? anchorId),
  );

  return (
    <Screen
      title={media.data?.asset.originalFileName ?? t('photo')}
      subtitle={t('fullImage')}>
      <QueryState
        loading={media.isPending}
        error={media.error}
        retry={() => void media.refetch()}>
        {media.data && (
          <View style={styles.card}>
            {media.data.asset.kind === 'photo' && media.data.reads[0] && (
              <Image
                source={{ uri: media.data.reads[0].url }}
                style={{ width: '100%', height: 400 }}
                resizeMode="contain"
                accessibilityLabel={media.data.asset.originalFileName}
              />
            )}
            <Text style={styles.secondary}>
              {media.data.asset.kind} ·{' '}
              {localizeStatus(media.data.asset.state, t)}
            </Text>
            {recordVideo && (
              <View style={styles.card}>
                <TextField
                  label={t('frameTimeSeconds')}
                  value={timeSeconds}
                  keyboardType="decimal-pad"
                  onChangeText={(value) => {
                    setTimeSeconds(value);
                    setJobId(null);
                  }}
                />
                <ActionButton
                  label={t('prepareFrame')}
                  onPress={() =>
                    void prepareFrame(
                      recordVideo.recordId,
                      recordVideo.durationMs,
                    )
                  }
                  disabled={busy || recordVideo.state !== 'ready'}
                />
                {frameJob.data && (
                  <Text style={styles.secondary}>
                    {localizeStatus(frameJob.data.state.kind, t)}
                  </Text>
                )}
                {frameJob.data?.state.kind === 'failed' && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {frameJob.data.state.error.message}
                  </Text>
                )}
                {frame && (
                  <Text style={styles.secondary}>
                    {t('actualFrameTime')}:{' '}
                    {(frame.frame.displayTimeMs / 1000).toFixed(3)}s
                  </Text>
                )}
                {frameRead && (
                  <Image
                    source={{ uri: frameRead.url }}
                    style={{ width: '100%', height: 300 }}
                    resizeMode="contain"
                    accessibilityLabel={t('preparedFrame')}
                  />
                )}
                {frame && !frameRead && (
                  <Text style={styles.secondary}>{t('processing')}</Text>
                )}
                {frameRead && frame && (
                  <ActionButton
                    label={newAnchorId ? t('saved') : t('useFrame')}
                    onPress={() =>
                      void useFrame(
                        recordVideo.recordId,
                        recordVideo.componentIds,
                        frame,
                      )
                    }
                    disabled={busy || Boolean(newAnchorId)}
                    secondary
                  />
                )}
              </View>
            )}
            {anchor && (
              <>
                <Text style={styles.heading}>{t('selectRegion')}</Text>
                <Text style={styles.body}>
                  {anchor.scope.kind === 'whole'
                    ? t('fullImage')
                    : `${anchor.scope.region.kind}: ${JSON.stringify(anchor.scope.region)}`}
                </Text>
                {anchor.kind === 'video_frame' && (
                  <Text style={styles.secondary}>
                    PTS {anchor.frame.pts} · {anchor.frame.displayTimeMs}ms
                  </Text>
                )}
              </>
            )}
          </View>
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
