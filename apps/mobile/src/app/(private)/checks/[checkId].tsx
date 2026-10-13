import { ActionButton, TextField, styles } from '@antica/ui';
import { useAuth } from '../../../auth';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../locale';
import { checkDetailSchema, checkPatchSchema } from '@antica/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

export default function CheckRoute() {
  const { checkId } = useLocalSearchParams<{ checkId: string }>();
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

  const recordResult = async (
    result: 'present' | 'absent' | 'undetermined',
  ): Promise<void> => {
    if (!detail.data || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = checkPatchSchema.parse({
        requestKey: randomUUID(),
        expectedRevision: detail.data.check.revision,
        expectedRecordRevision: detail.data.versions.recordRevision,
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
          queryKey: ['record', detail.data.check.recordId],
        }),
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('checks')}
      subtitle={detail.data?.method.definition.titleZhHant}>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}>
        {detail.data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>
                {detail.data.method.definition.titleZhHant}
              </Text>
              <Text style={styles.body}>
                {detail.data.check.result.kind === 'unrecorded'
                  ? t('notChecked')
                  : detail.data.check.result.kind === 'undetermined'
                    ? t('unable')
                    : t(
                        detail.data.check.result.kind === 'not_applicable'
                          ? 'notApplicable'
                          : detail.data.check.result.kind,
                      )}
              </Text>
              {detail.data.method.definition.steps.map((step) => (
                <Text key={step.order} style={styles.body}>
                  {step.order}. {step.actionZhHant} —{' '}
                  {step.evidenceToCaptureZhHant}
                </Text>
              ))}
              {detail.data.methodUpdateAvailable && (
                <Text style={styles.secondary}>{t('methodUpdated')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('collectorObservations')}</Text>
              {detail.data.observations.map((item) => (
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
                onPress={() => void recordResult('present')}
                disabled={busy}
              />
              <ActionButton
                label={t('absent')}
                onPress={() => void recordResult('absent')}
                disabled={busy}
                secondary
              />
              <ActionButton
                label={t('unable')}
                onPress={() => void recordResult('undetermined')}
                disabled={busy || !reason.trim()}
                secondary
              />
              <ActionButton
                label={t('addEvidence')}
                onPress={() =>
                  router.push(
                    `/capture?recordId=${detail.data.check.recordId}&checkId=${checkId}`,
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
}
