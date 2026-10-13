import { ActionButton, styles } from '@antica/ui';
import { useAuth } from '../../../auth';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { localizeStatus, useLocale } from '../../../locale';
import { taskPageSchema } from '@antica/contracts';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

export default function TasksRoute() {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: async ({ signal }) =>
      api.get('/v1/tasks?limit=50', taskPageSchema, signal),
  });

  return (
    <Screen title={t('tasks')}>
      <QueryState
        loading={tasks.isPending}
        error={tasks.error}
        retry={() => void tasks.refetch()}>
        {tasks.data?.items.length === 0 && (
          <Text style={styles.body}>{t('empty')}</Text>
        )}
        {tasks.data?.items.map((item) => (
          <View
            key={item.kind === 'recordCheck' ? item.check.id : item.action.id}
            style={styles.card}>
            <Text style={styles.heading}>
              {item.kind === 'recordCheck'
                ? t('checks')
                : item.action.instruction}
            </Text>
            <Text style={styles.secondary}>
              {item.kind === 'recordCheck'
                ? localizeStatus(item.check.progress, t)
                : localizeStatus(item.state.status, t)}
            </Text>
            <ActionButton
              label={t('view')}
              onPress={() =>
                router.push(
                  item.kind === 'recordCheck'
                    ? `/checks/${item.check.id}`
                    : `/analysis/${item.runId}`,
                )
              }
            />
          </View>
        ))}
      </QueryState>
    </Screen>
  );
}
