import { ActionButton, TextField, styles } from '@antica/ui';
import { useAuth } from '../../../auth';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../locale';
import {
  researchAcceptedSchema,
  researchRequestSchema,
} from '@antica/contracts';
import { randomUUID } from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

export default function NewResearchRoute() {
  const { recordId, entryId } = useLocalSearchParams<{
    recordId?: string;
    entryId?: string;
  }>();
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
}
