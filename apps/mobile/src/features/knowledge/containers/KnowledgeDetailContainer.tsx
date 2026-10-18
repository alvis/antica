import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Linking, Text, View } from 'react-native';

import {
  knowledgeDetailSchema,
  knowledgeUpdateSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

export type KnowledgeDetailContainerProps = { entryId: string };

export const KnowledgeDetailContainer: FC<KnowledgeDetailContainerProps> = ({
  entryId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = useQuery({
    queryKey: ['knowledge-detail', entryId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/knowledge/${entryId}`, knowledgeDetailSchema, signal),
  });

  const save = async (): Promise<void> => {
    if (!detail.data || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const entry = detail.data.entry;
      const request = knowledgeUpdateSchema.parse({
        requestKey: randomUUID(),
        expectedRevision: entry.revision,
        status: 'saved',
        content: {
          ...entry.content,
          titleZhHant: title ?? entry.content.titleZhHant,
          summary: {
            ...entry.content.summary,
            textZhHant: summary ?? entry.content.summary.textZhHant,
          },
        },
        methodWrites: [],
        linkedMethodIds: entry.methodIds,
        originResearchId: null,
      });
      await api.patch(`/v1/knowledge/${entryId}`, knowledgeDetailSchema, {
        body: request,
        idempotencyKey: request.requestKey,
      });
      await queryClient.invalidateQueries({
        queryKey: ['knowledge-detail', entryId],
      });
      setTitle(null);
      setSummary(null);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={detail.data?.entry.content.titleZhHant ?? t('knowledgeDraft')}
      subtitle={
        detail.data ? localizeStatus(detail.data.entry.status, t) : undefined
      }>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}>
        {detail.data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('knowledgeDraft')}</Text>
              <TextField
                label={t('name')}
                value={title ?? detail.data.entry.content.titleZhHant}
                onChangeText={setTitle}
              />
              <TextField
                label={t('summary')}
                value={summary ?? detail.data.entry.content.summary.textZhHant}
                onChangeText={setSummary}
                multiline
              />
              <Text style={styles.secondary}>
                {detail.data.entry.content.summary.support === 'needs_source'
                  ? t('sourceNeedsReview')
                  : `${detail.data.entry.content.summary.citationIds.length} ${t('citations')}`}
              </Text>
              <ActionButton
                label={t('save')}
                onPress={() => void save()}
                disabled={busy}
              />
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('history')}</Text>
              {detail.data.entry.content.history.map((item, index) => (
                <Text key={index} style={styles.body}>
                  {item.textZhHant}{' '}
                  {item.support === 'needs_source'
                    ? `(${t('sourceNeedsReview')})`
                    : ''}
                </Text>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('scope')}</Text>
              {detail.data.entry.content.applicability.map((item, index) => (
                <Text key={index} style={styles.body}>
                  {item.scope}: {item.limits.textZhHant}
                </Text>
              ))}
              {detail.data.entry.content.applicability.length === 0 && (
                <Text style={styles.secondary}>{t('noScopeInfo')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('methods')}</Text>
              {detail.data.methodVersions.map((method) => (
                <Text key={method.id} style={styles.body}>
                  {method.definition.titleZhHant}:{' '}
                  {method.definition.steps
                    .map((step) => step.actionZhHant)
                    .join(' · ')}
                </Text>
              ))}
              {detail.data.methodVersions.length === 0 && (
                <Text style={styles.secondary}>{t('noMethodInfo')}</Text>
              )}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('examples')}</Text>
              {detail.data.referenceImages.map((image) => (
                <ActionButton
                  key={image.id}
                  label={
                    image.originalCaption?.textAsPrinted ?? t('viewSource')
                  }
                  onPress={() =>
                    image.locator.kind === 'page'
                      ? router.push(
                          `/sources/${image.locator.sourceId}?versionId=${image.locator.sourceVersionId}&pageId=${image.locator.pageId}`,
                        )
                      : void Linking.openURL(image.locator.url).catch((cause) =>
                          setError((cause as Error).message),
                        )
                  }
                  secondary
                />
              ))}
              {detail.data.citations.map((citation) => (
                <ActionButton
                  key={citation.id}
                  label={`${t('viewSource')} ${citation.id.slice(0, 8)}`}
                  onPress={() =>
                    citation.locator.kind === 'page'
                      ? router.push(
                          `/sources/${citation.locator.sourceId}?versionId=${citation.locator.sourceVersionId}&pageId=${citation.locator.pageId}`,
                        )
                      : void Linking.openURL(citation.locator.url).catch(
                          (cause) => setError((cause as Error).message),
                        )
                  }
                  secondary
                />
              ))}
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
