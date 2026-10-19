import { useQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Text, View } from 'react-native';

import { knowledgePageSchema } from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { SettingsAction } from '../../../components/SettingsAction';
import { localizeKnowledgeKind, localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export const KnowledgeContainer: FC = () => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const parameters = new URLSearchParams({ limit: '50' });
  if (query) {
    parameters.set('q', query);
  }
  if (cursor) {
    parameters.set('cursor', cursor);
  }
  const entries = useQuery({
    queryKey: ['knowledge', query, cursor],
    queryFn: async ({ signal }) =>
      api.get(`/v1/knowledge?${parameters}`, knowledgePageSchema, signal),
  });

  return (
    <Screen title={t('knowledge')} action={<SettingsAction />}>
      <ActionButton
        label={t('importBook')}
        onPress={() => router.push('/sources/new')}
      />
      <TextField
        label={t('search')}
        value={query}
        onChangeText={(value) => {
          setQuery(value);
          setCursor(null);
        }}
      />
      <QueryState
        loading={entries.isPending}
        error={entries.error}
        retry={() => void entries.refetch()}>
        {entries.data?.items.length === 0 && (
          <Text style={styles.body}>{t('empty')}</Text>
        )}
        {entries.data?.items.map((entry) => (
          <View key={entry.id} style={styles.card}>
            <Text style={styles.heading}>{entry.titleZhHant}</Text>
            <Text style={styles.secondary}>
              {entry.displayCode} · {localizeStatus(entry.status, t)} ·{' '}
              {entry.kinds
                .map((kind) => localizeKnowledgeKind(kind, t))
                .join(', ')}
            </Text>
            <Text style={styles.body}>{entry.summaryZhHant}</Text>
            <ActionButton
              label={t('view')}
              onPress={() => router.push(`/knowledge/${entry.id}`)}
              secondary
            />
          </View>
        ))}
        {entries.data?.nextCursor && (
          <ActionButton
            label={t('more')}
            onPress={() => setCursor(entries.data.nextCursor)}
            secondary
          />
        )}
      </QueryState>
    </Screen>
  );
};
