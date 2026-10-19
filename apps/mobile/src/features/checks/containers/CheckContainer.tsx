import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Text, View } from 'react-native';

import { checkDetailSchema, checkPatchSchema } from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export type CheckContainerProps = { checkId: string };

export const CheckContainer: FC<CheckContainerProps> = ({ checkId }) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = useQuery({
    queryKey: ['check', checkId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/checks/${checkId}`, checkDetailSchema, signal),
  });

  const data = detail.data;

  // the result buttons render only with loaded data and are disabled while busy
  const recordResult = async (
    loaded: NonNullable<typeof data>,
    result: 'present' | 'absent' | 'undetermined',
  ): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const request = checkPatchSchema.parse({
        requestKey: randomUUID(),
        expectedRevision: loaded.check.revision,
        expectedRecordRevision: loaded.versions.recordRevision,
        progress: 'recorded',
        result:
          result === 'undetermined'
            ? { kind: result, reason: reason.trim() }
            : { kind: result },
      });
      await api.patch(`/v1/checks/${checkId}`, checkDetailSchema, {
        body: request,
        idempotencyKey: request.requestKey,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['check', checkId] }),
        queryClient.invalidateQueries({
          queryKey: ['record', loaded.check.recordId],
        }),
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('checks')} subtitle={data?.method.definition.titleZhHant}>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}>
        {data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>
                {data.method.definition.titleZhHant}
              </Text>
              <Text style={styles.body}>
                {data.check.result.kind === 'unrecorded'
                  ? t('notChecked')
                  : data.check.result.kind === 'undetermined'
                    ? t('unable')
                    : t(
                        data.check.result.kind === 'not_applicable'
                          ? 'notApplicable'
                          : data.check.result.kind,
                      )}
              </Text>
              {data.method.definition.steps.map((step) => (
                <Text key={step.order} style={styles.body}>
                  {step.order}. {step.actionZhHant} —{' '}
                  {step.evidenceToCaptureZhHant}
                </Text>
              ))}
              {data.methodUpdateAvailable && (
                <Text style={styles.secondary}>{t('methodUpdated')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('collectorObservations')}</Text>
              {data.observations.map((item) => (
                <Text key={item.id} style={styles.body}>
                  {item.text}
                </Text>
              ))}
              <TextField
                label={t('reason')}
                value={reason}
                onChangeText={setReason}
                multiline
              />
              <ActionButton
                label={t('present')}
                onPress={() => void recordResult(data, 'present')}
                disabled={busy}
              />
              <ActionButton
                label={t('absent')}
                onPress={() => void recordResult(data, 'absent')}
                disabled={busy}
                secondary
              />
              <ActionButton
                label={t('unable')}
                onPress={() => void recordResult(data, 'undetermined')}
                disabled={busy || !reason.trim()}
                secondary
              />
              <ActionButton
                label={t('addEvidence')}
                onPress={() =>
                  router.push(
                    `/capture?recordId=${data.check.recordId}&checkId=${checkId}`,
                  )
                }
                secondary
              />
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
