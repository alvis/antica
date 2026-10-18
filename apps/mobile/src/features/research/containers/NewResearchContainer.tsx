import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Text, View } from 'react-native';

import {
  researchAcceptedSchema,
  researchRequestSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

export type NewResearchContainerProps = { recordId?: string; entryId?: string };

export const NewResearchContainer: FC<NewResearchContainerProps> = ({
  recordId,
  entryId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const [question, setQuestion] = useState('');
  const [scope, setScope] = useState<'curated_only' | 'curated_and_public_web'>(
    'curated_only',
  );
  const [preferNamed, setPreferNamed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async (): Promise<void> => {
    if (busy || !question.trim()) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const request = researchRequestSchema.parse({
        requestKey: randomUUID(),
        instructionZhHant: question.trim(),
        scope,
        recordId: recordId ?? null,
        entryId: entryId ?? null,
        sourceIds: [],
        preferNamedAuthors: preferNamed,
      });
      const accepted = await api.post('/v1/research', researchAcceptedSchema, {
        body: request,
        idempotencyKey: request.requestKey,
      });
      router.replace(`/research/${accepted.researchId}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('newResearch')}>
      <View style={styles.card}>
        <TextField
          label={t('question')}
          value={question}
          onChangeText={setQuestion}
          multiline
        />
        <Text style={styles.secondary}>{t('originalLanguage')}</Text>
        <ActionButton
          label={t('curatedOnly')}
          onPress={() => setScope('curated_only')}
          secondary={scope !== 'curated_only'}
        />
        <ActionButton
          label={t('curatedWeb')}
          onPress={() => setScope('curated_and_public_web')}
          secondary={scope !== 'curated_and_public_web'}
        />
        <ActionButton
          label={t('namedAuthors')}
          onPress={() => setPreferNamed((value) => !value)}
          secondary={!preferNamed}
        />
        <ActionButton
          label={busy ? t('processing') : t('startResearch')}
          onPress={() => void start()}
          disabled={busy || !question.trim()}
        />
      </View>
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
